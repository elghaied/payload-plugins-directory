import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectionBeforeChangeHook, Payload } from 'payload'
import { computeContentHash } from '@/sync/contentHash'
import { RateLimitError } from '@/sync/http'
import { runSyncRepository } from '@/sync/syncRepository'
import { trashPlugins } from '@/sync/trash'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { contents, dirEntry, ghRepo, json, npmRoutes, pkg, raw, repoById, repoByName, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext, syncFetch } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')
const SEO = ghRepo(7, 'acme/payload-seo', { pushed_at: '2026-10-18T09:00:00Z', topics: ['payload-plugin', 'seo'] })
const SEO_PKG = { name: 'payload-seo', description: 'SEO tools', keywords: ['metadata'], peerDependencies: { payload: '^3.0.0' } }
const input = { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' as const }

const seoRoutes = (repo = SEO, readme = '# SEO\n\nFull readme.'): Record<string, FakeRoute> => ({
  [repoById(repo.id)]: json(repo),
  [raw(repo.full_name, 'package.json')]: pkg(SEO_PKG),
  [raw(repo.full_name, 'README.md')]: text(readme),
})
const sync = (routes: Record<string, FakeRoute>, i: Parameters<typeof runSyncRepository>[1] = input) =>
  runSyncRepository(payload, i, syncContext(syncFetch(routes), NOW))
const plugin = async (slug: string) =>
  (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: slug } } })).docs[0]

/** Makes the next plugin write throw once (a mid-sync database failure). */
function failNextPluginWrite(): void {
  const hooks = payload.collections.plugins.config.hooks.beforeChange
  const hook: CollectionBeforeChangeHook = () => {
    hooks.splice(hooks.indexOf(hook), 1)
    throw new Error('injected plugin write failure')
  }
  hooks.push(hook)
}
const repoRow = async (id: number) => payload.findByID({ collection: 'repositories', id, overrideAccess: true, depth: 0 })

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => resetDatabase(payload))

describe('runSyncRepository', () => {
  it('creates the repository and its plugin for a new repository', async () => {
    const r = await sync(seoRoutes())
    expect(r).toMatchObject({ status: 'synced', contentReRead: true, created: ['7-root'], updated: [], trashed: [], revalidateTags: ['plugins', 'plugin:7-root'] })
    const repo = await payload.findByID({ collection: 'repositories', id: r.repositoryId!, overrideAccess: true })
    expect(repo).toMatchObject({ fullName: 'acme/payload-seo', githubId: 7, stars: 42, isMonorepo: false, lastSyncedAt: NOW.toISOString() })
    const doc = await plugin('7-root')
    expect(doc).toMatchObject({
      name: 'payload seo', packageName: 'payload-seo', source: 'topic', visibility: 'listed', readme: '# SEO\n\nFull readme.',
      payloadVersionRange: '^3.0.0', payloadMajors: ['3'], firstSeenAt: NOW.toISOString(),
    })
    expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(doc.healthScore).toBeGreaterThan(0)
    expect(r.contentChanged).toEqual([doc.id])
  })

  it('stores a 75,000-character README (above the Payload default text limit)', async () => {
    const readme = `# Big\n${'word '.repeat(15_000)}`.slice(0, 75_000)
    const r = await sync(seoRoutes(SEO, readme))
    expect(r.created).toEqual(['7-root'])
    expect((await plugin('7-root')).readme).toBe(readme)
    expect((await plugin('7-root')).readmeTruncated).toBe(false)
  })

  it('truncates a 150,000-character README to 100,000 characters with a stable contentHash', async () => {
    const readme = `# Huge\n${'line of text\n'.repeat(12_000)}`
    expect(readme.length).toBeGreaterThan(150_000)
    await sync(seoRoutes(SEO, readme))
    const doc = await plugin('7-root')
    expect(doc.readme!.length).toBeLessThanOrEqual(100_000)
    expect(doc.readme!.length).toBeGreaterThan(98_000)
    expect(readme.startsWith(doc.readme!)).toBe(true)
    expect(doc.readmeTruncated).toBe(true)
    await sync(seoRoutes({ ...SEO, pushed_at: '2026-10-19T09:00:00Z' }, readme), input)
    expect((await plugin('7-root')).contentHash).toBe(doc.contentHash)
  })

  it('clamps an oversized package.json description and keywords instead of failing the sync', async () => {
    const routes = seoRoutes()
    routes[raw(SEO.full_name, 'package.json')] = pkg({
      ...SEO_PKG, description: 'd'.repeat(60_000), keywords: ['k'.repeat(60_000), 'ok'], peerDependencies: { payload: 'v'.repeat(60_000) },
    })
    const r = await sync(routes)
    expect(r.created).toEqual(['7-root'])
    const doc = await plugin('7-root')
    expect(doc.description!.length).toBeLessThanOrEqual(2_000)
    expect(doc.keywords!.every((k) => k.length <= 100)).toBe(true)
  })

  it('skips content reads when pushedAt is unchanged but refreshes repository stats', async () => {
    await sync(seoRoutes())
    const f = fakeFetch({ [repoById(7)]: json({ ...SEO, stargazers_count: 99 }) }) // any raw read would reject
    const r = await runSyncRepository(payload, input, syncContext(f, NOW))
    expect(r).toMatchObject({ contentReRead: false, created: [], revalidateTags: ['plugins', 'plugin:7-root'] })
    expect(f.calls.map((c) => c.url)).toEqual([repoById(7)])
    expect((await payload.findByID({ collection: 'repositories', id: r.repositoryId!, overrideAccess: true })).stars).toBe(99)
  })

  it('leaves plugins unchanged and revalidates nothing when GitHub reports no change', async () => {
    await sync(seoRoutes())
    const r = await sync({ [repoById(7)]: json(SEO) })
    expect(r).toMatchObject({ contentReRead: false, updated: [], revalidateTags: [] })
  })

  it('re-reads content when pushedAt changes and trashes packages removed from a monorepo', async () => {
    const MONO = ghRepo(21, 'acme/mono')
    const monoRoutes = (repo: typeof MONO, dirs: string[], readmeA: string): Record<string, FakeRoute> => ({
      [repoById(21)]: json(repo),
      [raw('acme/mono', 'package.json')]: pkg({ private: true, workspaces: ['packages/*'] }),
      [contents('acme/mono', 'packages')]: json(dirs.map((d) => dirEntry(d, `packages/${d}`))),
      [raw('acme/mono', 'packages/a/package.json')]: pkg({ name: 'payload-a', peerDependencies: { payload: '^3.0.0' } }),
      [raw('acme/mono', 'packages/b/package.json')]: pkg({ name: 'payload-b', peerDependencies: { payload: '^3.0.0' } }),
      [raw('acme/mono', 'packages/a/README.md')]: text(readmeA),
    })
    const monoInput = { fullName: 'acme/mono', githubId: 21, source: 'topic' as const }
    expect((await sync(monoRoutes(MONO, ['a', 'b'], '# A'), monoInput)).created).toEqual(['21-a', '21-b'])

    const pushed = { ...MONO, pushed_at: '2026-10-19T08:00:00Z' }
    const r = await sync(monoRoutes(pushed, ['a'], '# A, revised'), monoInput)
    const a = await plugin('21-a')
    expect(r).toMatchObject({ contentReRead: true, updated: ['21-a'], trashed: ['21-b'], contentChanged: [a.id] })
    expect(a.readme).toBe('# A, revised')
    expect(await plugin('21-b')).toMatchObject({ syncTrashReason: 'package-removed', deletedAt: NOW.toISOString() })
  })

  it('trashes every plugin when the repository returns 404', async () => {
    await sync(seoRoutes())
    const r = await sync({ [repoById(7)]: { status: 404 } })
    expect(r).toMatchObject({ status: 'gone', trashed: ['7-root'], revalidateTags: ['plugins', 'plugin:7-root'] })
    expect(await plugin('7-root')).toMatchObject({ syncTrashReason: 'repository-gone' })
  })

  it('restores sync-trashed plugins only on rediscovery, and never admin-trashed ones', async () => {
    const first = await sync(seoRoutes())
    await trashPlugins(payload, { repository: { equals: first.repositoryId } }, 'repository-gone', NOW)

    const check = await sync({ [repoById(7)]: json(SEO) }, { ...input, discovered: false })
    expect(check).toMatchObject({ contentReRead: false, restored: [] })
    expect((await plugin('7-root')).deletedAt).toBeTruthy()

    const back = await sync(seoRoutes())
    expect(back).toMatchObject({ contentReRead: true, restored: ['7-root'], created: [] })
    const restored = await plugin('7-root')
    expect(restored.deletedAt ?? null).toBeNull()
    expect(restored.syncTrashReason ?? null).toBeNull()

    await payload.update({ collection: 'plugins', id: restored.id, overrideAccess: true, data: { deletedAt: NOW.toISOString() } })
    const again = await sync(seoRoutes({ ...SEO, pushed_at: '2026-10-19T10:00:00Z' }))
    expect(again).toMatchObject({ restored: [], updated: ['7-root'], created: [] })
    expect((await plugin('7-root')).deletedAt).toBeTruthy()
    expect((await payload.count({ collection: 'plugins', overrideAccess: true, trash: true })).totalDocs).toBe(1)
  })

  it('leaves the database untouched when a rate limit interrupts the content read', async () => {
    const first = await sync(seoRoutes())
    const err = await sync({
      [repoById(7)]: json({ ...SEO, pushed_at: '2026-10-19T11:00:00Z', stargazers_count: 77 }),
      [raw('acme/payload-seo', 'package.json')]: { status: 429, headers: { 'retry-after': '120' } },
    }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    const repo = await payload.findByID({ collection: 'repositories', id: first.repositoryId!, overrideAccess: true })
    expect(repo).toMatchObject({ pushedAt: '2026-10-18T09:00:00.000Z', stars: 42 })
  })

  it('never writes admin-owned fields', async () => {
    await sync(seoRoutes())
    const doc = await plugin('7-root')
    await payload.update({
      collection: 'plugins', id: doc.id, overrideAccess: true,
      data: { visibility: 'hidden', customTagline: 'Mine', ai: { tagline: 'Curated' }, locks: { summary: true } },
    })
    await sync(seoRoutes({ ...SEO, pushed_at: '2026-10-19T10:00:00Z' }, '# Changed'))
    expect(await plugin('7-root')).toMatchObject({
      visibility: 'hidden', customTagline: 'Mine', ai: { tagline: 'Curated' }, locks: { summary: true }, readme: '# Changed',
    })
  })

  it('skips community copies of official packages and adds alias-mapped tags', async () => {
    const official = await createRepo(payload, { fullName: 'payloadcms/payload', owner: 'payloadcms' })
    await createPlugin(payload, official.id, { slug: 'official-plugin-seo', packageName: '@payloadcms/plugin-seo', source: 'official', isOfficial: true })
    const seoTag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'SEO', slug: 'seo', aliases: ['seo'] } })
    const FORK = ghRepo(31, 'acme/fork', { topics: ['payload-plugin'] })
    const r = await sync({
      [repoById(31)]: json(FORK),
      [raw('acme/fork', 'package.json')]: pkg({ private: true, workspaces: ['packages/*'] }),
      [contents('acme/fork', 'packages')]: json([dirEntry('seo-copy', 'packages/seo-copy'), dirEntry('meta', 'packages/meta')]),
      [raw('acme/fork', 'packages/seo-copy/package.json')]: pkg({ name: '@payloadcms/plugin-seo', peerDependencies: { payload: '^3.0.0' } }),
      [raw('acme/fork', 'packages/meta/package.json')]: pkg({ name: 'payload-meta', keywords: ['SEO'], peerDependencies: { payload: '^3.0.0' } }),
    }, { fullName: 'acme/fork', githubId: 31, source: 'topic' })
    expect(r.created).toEqual(['31-meta'])
    expect((await plugin('31-meta'))._h_tags?.map((t) => (typeof t === 'object' ? t.id : t))).toEqual([seoTag.id])
  })

  it('never adds tags to a plugin whose tags an admin locked, on content and metadata-only syncs', async () => {
    const seoTag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'SEO', slug: 'seo', aliases: ['seo'] } })
    const ids = async () => ((await plugin('7-root'))._h_tags ?? []).map((t) => (typeof t === 'object' ? t.id : t))
    // Unlocked control: the `seo` topic maps to the tag.
    await sync(seoRoutes())
    expect(await ids()).toEqual([seoTag.id])
    // The admin removes the tag and locks tags.
    const doc = await plugin('7-root')
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { _h_tags: [], locks: { tags: true } } })
    // Content re-read (new push).
    expect((await sync(seoRoutes({ ...SEO, pushed_at: '2026-10-19T09:00:00Z' }))).contentReRead).toBe(true)
    expect(await ids()).toEqual([])
    // Metadata-only sync (same push).
    expect((await sync({ [repoById(7)]: json({ ...SEO, pushed_at: '2026-10-19T09:00:00Z', stargazers_count: 99 }) })).contentReRead).toBe(false)
    expect(await ids()).toEqual([])
  })

  it('B3: keeps AI tags an enrichment wrote while the sync was fetching (no lost read-modify-write)', async () => {
    const seoTag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'SEO', slug: 'seo', aliases: ['seo'] } })
    const aiTag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'Sitemaps', slug: 'sitemaps', createdBy: 'ai' } })
    await sync(seoRoutes())
    const doc = await plugin('7-root')
    const ids = async () => ((await plugin('7-root'))._h_tags ?? []).map((t) => (typeof t === 'object' ? t.id : t)).sort((a, b) => a - b)
    /** An enrichment lands after sync read the plugin and before it writes (here: while it loads the alias tags). */
    const enrichDuringNextSync = () => {
      const find = payload.find.bind(payload)
      const spy = vi.spyOn(payload, 'find').mockImplementation((async (args: { collection: string }) => {
        if (args.collection === 'tags') {
          spy.mockRestore()
          await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, context: { enrichment: true }, data: { _h_tags: [seoTag.id, aiTag.id] } })
        }
        return find(args as never)
      }) as never)
    }
    const pushed = { ...SEO, pushed_at: '2026-10-19T10:00:00Z' }
    enrichDuringNextSync()
    expect((await sync(seoRoutes(pushed, '# Changed'))).contentReRead).toBe(true)
    expect(await ids()).toEqual([seoTag.id, aiTag.id].sort((a, b) => a - b))

    // Metadata-only sync (same push, more stars): the same race.
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { _h_tags: [seoTag.id] } })
    enrichDuringNextSync()
    expect((await sync({ [repoById(7)]: json({ ...pushed, stargazers_count: 7 }) })).contentReRead).toBe(false)
    expect(await ids()).toEqual([seoTag.id, aiTag.id].sort((a, b) => a - b))
  })

  it('matches a seeded repository by full name and fills its githubId', async () => {
    const seeded = await createRepo(payload, { fullName: 'acme/payload-seo', owner: 'acme', url: 'https://github.com/acme/payload-seo' })
    await createPlugin(payload, seeded.id, { slug: '7-root', packageName: 'payload-seo' })
    const r = await sync({ ...seoRoutes(), [repoByName('acme/payload-seo')]: json(SEO) }, { fullName: 'acme/payload-seo', source: 'topic' })
    expect(r).toMatchObject({ repositoryId: seeded.id, contentReRead: true, created: [], updated: ['7-root'] })
    expect((await payload.findByID({ collection: 'repositories', id: seeded.id, overrideAccess: true })).githubId).toBe(7)
    expect((await payload.count({ collection: 'repositories', overrideAccess: true })).totalDocs).toBe(1)
  })

  it('reports contentChanged against ai.enrichedHash, so unenriched content is retried', async () => {
    await sync(seoRoutes())
    const doc = await plugin('7-root')
    const pushed = (at: string) => seoRoutes({ ...SEO, pushed_at: at })

    // Same content re-read, never enriched: still reported.
    expect((await sync(pushed('2026-10-19T09:00:00Z'))).contentChanged).toEqual([doc.id])

    // Enriched at the current hash: not reported.
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { ai: { enrichedHash: doc.contentHash } } })
    const r = await sync(pushed('2026-10-19T10:00:00Z'))
    expect(r).toMatchObject({ contentReRead: true, updated: ['7-root'], contentChanged: [] })

    // Content changed since enrichment: reported.
    expect((await sync(seoRoutes({ ...SEO, pushed_at: '2026-10-19T11:00:00Z' }, '# New'))).contentChanged).toEqual([doc.id])
  })

  it('keeps contentHash across version bumps and dependency updates, but not keyword changes', async () => {
    await sync(seoRoutes())
    const doc = await plugin('7-root')
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { ai: { enrichedHash: doc.contentHash } } })
    const pushed = (at: string, pkgJson: Record<string, unknown>) => ({
      ...seoRoutes({ ...SEO, pushed_at: at }),
      [raw(SEO.full_name, 'package.json')]: pkg(pkgJson),
    })
    const bumped = { ...SEO_PKG, version: '2.0.0', dependencies: { lodash: '^4.17.21' } }
    const r = await sync(pushed('2026-10-19T09:00:00Z', bumped))
    expect(r).toMatchObject({ contentReRead: true, contentChanged: [] })
    expect((await plugin('7-root')).contentHash).toBe(doc.contentHash)
    expect((await sync(pushed('2026-10-19T10:00:00Z', { ...bumped, keywords: ['metadata', 'og'] }))).contentChanged).toEqual([doc.id])
  })

  it('syncs the official monorepo, resolving workspace:* majors from npm', async () => {
    const PAYLOAD = ghRepo(100, 'payloadcms/payload', { open_issues_count: 900 })
    const r = await sync(
      {
        [repoById(100)]: json(PAYLOAD),
        [contents('payloadcms/payload', 'packages')]: json([dirEntry('plugin-seo', 'packages/plugin-seo'), dirEntry('ui', 'packages/ui')]),
        [raw('payloadcms/payload', 'packages/plugin-seo/package.json')]: pkg({ name: '@payloadcms/plugin-seo', peerDependencies: { payload: 'workspace:*' } }),
        ...npmRoutes('@payloadcms/plugin-seo', { version: '3.60.0' }),
      },
      { fullName: 'payloadcms/payload', githubId: 100, source: 'topic' },
    )
    expect(r).toMatchObject({ status: 'synced', created: ['official-plugin-seo'] })
    expect(await plugin('official-plugin-seo')).toMatchObject({
      source: 'official', isOfficial: true, payloadVersionRange: 'workspace:*', payloadMajors: ['3'],
    })
  })

  it('keeps the monorepo version of an official plugin: npm latest 3.x and main 4.x give both majors', async () => {
    const PAYLOAD = ghRepo(100, 'payloadcms/payload', { open_issues_count: 900 })
    const seo = { name: '@payloadcms/plugin-seo', peerDependencies: { payload: 'workspace:*' } }
    await sync(
      {
        [repoById(100)]: json(PAYLOAD),
        [contents('payloadcms/payload', 'packages')]: json([dirEntry('plugin-seo', 'packages/plugin-seo')]),
        [raw('payloadcms/payload', 'packages/plugin-seo/package.json')]: pkg({ ...seo, version: '4.0.0-beta.4' }),
        ...npmRoutes('@payloadcms/plugin-seo', { version: '3.92.0' }),
      },
      { fullName: 'payloadcms/payload', githubId: 100, source: 'topic' },
    )
    const doc = await plugin('official-plugin-seo')
    expect(doc).toMatchObject({ payloadVersionRange: 'workspace:4.0.0-beta.4', payloadMajors: ['3', '4'] })
    // The hash is taken from the range as written, so a version bump on main re-bills no enrichment.
    expect(doc.contentHash).toBe(computeContentHash({ packageName: seo.name, description: 'Official Payload CMS seo plugin', keywords: [], payloadVersionRange: 'workspace:*' }))
  })

  it('keeps plugins and templates apart: skips a templated path, leaves templates untouched, official plugins unaffected', async () => {
    // Community: a root template blocks the root plugin.
    const row = await createRepo(payload, { fullName: 'acme/payload-seo', owner: 'acme', githubId: 7 })
    const tpl = await payload.create({
      collection: 'templates', overrideAccess: true, depth: 0, context: { skipRevalidate: true },
      data: { slug: '7-root', name: 'Tpl', repository: row.id, url: 'https://github.com/acme/payload-seo', source: 'submission' } as never,
    })
    expect(await sync(seoRoutes())).toMatchObject({ status: 'synced', created: [] })
    expect(await plugin('7-root')).toBeUndefined()
    const after = await payload.findByID({ collection: 'templates', id: tpl.id, overrideAccess: true, trash: true, depth: 0 })
    expect(after).toMatchObject({ name: 'Tpl', deletedAt: null, updatedAt: tpl.updatedAt })

    // Official monorepo: templates live under templates/, plugins under packages/ — no overlap.
    const PAYLOAD = ghRepo(100, 'payloadcms/payload', { open_issues_count: 900 })
    const official = await createRepo(payload, { fullName: 'payloadcms/payload', owner: 'payloadcms', githubId: 100 })
    const website = await payload.create({
      collection: 'templates', overrideAccess: true, depth: 0, context: { skipRevalidate: true },
      data: { slug: 'website', name: 'Website', repository: official.id, path: 'templates/website', url: 'https://github.com/payloadcms/payload', source: 'official', isOfficial: true } as never,
    })
    const r = await sync(
      {
        [repoById(100)]: json(PAYLOAD),
        [contents('payloadcms/payload', 'packages')]: json([dirEntry('plugin-seo', 'packages/plugin-seo')]),
        [raw('payloadcms/payload', 'packages/plugin-seo/package.json')]: pkg({ name: '@payloadcms/plugin-seo', peerDependencies: { payload: '^3.0.0' } }),
      },
      { fullName: 'payloadcms/payload', githubId: 100, source: 'official' },
    )
    expect(r.created).toEqual(['official-plugin-seo'])
    const websiteAfter = await payload.findByID({ collection: 'templates', id: website.id, overrideAccess: true, trash: true, depth: 0 })
    expect(websiteAfter).toMatchObject({ deletedAt: null, updatedAt: website.updatedAt })
  })

  describe('pushedAt advances only after every plugin write', () => {
    it('re-reads a new repository whose first sync failed mid-write', async () => {
      failNextPluginWrite()
      await expect(sync(seoRoutes())).rejects.toThrow('injected plugin write failure')
      const row = (await payload.find({ collection: 'repositories', overrideAccess: true, where: { githubId: { equals: 7 } } })).docs[0]
      expect(row).toMatchObject({ pushedAt: null, lastSyncedAt: null })

      const r = await sync(seoRoutes())
      expect(r).toMatchObject({ repositoryId: row.id, contentReRead: true, created: ['7-root'] })
      expect(await repoRow(row.id)).toMatchObject({ pushedAt: '2026-10-18T09:00:00.000Z', lastSyncedAt: NOW.toISOString() })
    })

    it('re-reads a pushed repository whose sync failed mid-write', async () => {
      const first = await sync(seoRoutes())
      const pushed = seoRoutes({ ...SEO, pushed_at: '2026-10-19T10:00:00Z', stargazers_count: 50 }, '# Changed')
      failNextPluginWrite()
      await expect(sync(pushed)).rejects.toThrow('injected plugin write failure')
      expect(await repoRow(first.repositoryId!)).toMatchObject({ pushedAt: '2026-10-18T09:00:00.000Z', stars: 50 })

      const r = await sync(pushed)
      expect(r).toMatchObject({ contentReRead: true, updated: ['7-root'] })
      expect((await plugin('7-root')).readme).toBe('# Changed')
      expect(await repoRow(first.repositoryId!)).toMatchObject({ pushedAt: '2026-10-19T10:00:00.000Z' })
    })
  })

  describe('repository identity is the GitHub id', () => {
    it('never adopts another repository\'s row that holds the same full name', async () => {
      const old = await createRepo(payload, { fullName: 'a/x', owner: 'a', githubId: 1, url: 'https://github.com/a/x' })
      await createPlugin(payload, old.id, { slug: '1-root' })
      const r = await sync({ [repoById(2)]: json(ghRepo(2, 'a/x')) }, { fullName: 'a/x', githubId: 2, source: 'topic' })
      expect(r.repositoryId).not.toBe(old.id)
      expect(r.created).toEqual(['2-root'])
      expect(await repoRow(r.repositoryId!)).toMatchObject({ githubId: 2, fullName: 'a/x' })
      expect(await repoRow(old.id)).toMatchObject({ githubId: 1, fullName: 'a/x~stale-1', stars: 10 })
      expect((await plugin('1-root')).deletedAt ?? null).toBeNull()
    })

    it('does not trash another repository\'s plugins when the requested id is gone', async () => {
      const old = await createRepo(payload, { fullName: 'a/x', owner: 'a', githubId: 1, url: 'https://github.com/a/x' })
      await createPlugin(payload, old.id, { slug: '1-root' })
      const r = await sync({ [repoById(2)]: { status: 404 } }, { fullName: 'a/x', githubId: 2, source: 'topic' })
      expect(r).toMatchObject({ status: 'gone', repositoryId: null, trashed: [] })
      expect((await plugin('1-root')).deletedAt ?? null).toBeNull()
    })

    it('adopts a seeded row (no githubId) by full name and sets its githubId', async () => {
      const seeded = await createRepo(payload, { fullName: 'acme/payload-seo', owner: 'acme', url: 'https://github.com/acme/payload-seo' })
      const r = await sync(seoRoutes())
      expect(r.repositoryId).toBe(seeded.id)
      expect(await repoRow(seeded.id)).toMatchObject({ githubId: 7, fullName: 'acme/payload-seo' })
      expect((await payload.count({ collection: 'repositories', overrideAccess: true })).totalDocs).toBe(1)
    })

    it('follows a rename by githubId and updates the full name', async () => {
      const row = await createRepo(payload, { fullName: 'a/x', owner: 'a', githubId: 1, url: 'https://github.com/a/x' })
      const r = await sync({ [repoById(1)]: json(ghRepo(1, 'a/y')) }, { fullName: 'a/y', githubId: 1, source: 'topic' })
      expect(r.repositoryId).toBe(row.id)
      expect(await repoRow(row.id)).toMatchObject({ githubId: 1, fullName: 'a/y', url: 'https://github.com/a/y' })
      expect((await payload.count({ collection: 'repositories', overrideAccess: true })).totalDocs).toBe(1)
    })
  })
})
