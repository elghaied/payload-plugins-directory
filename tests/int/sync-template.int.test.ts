import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import type { Template } from '@/payload-types'
import type { ReadmeRendering } from '@/sync/context'
import { readmeStamp } from '@/lib/directory/readmeStamp'
import { renderReadmeBatch, renderReadmes } from '@/lib/directory/renderReadmes'
import { setSyncDeps } from '@/sync/deps'
import { runSyncRepository } from '@/sync/syncRepository'
import { runDiscoverTemplates, runSyncTemplate, type SyncTemplateInput } from '@/sync/templates/syncTemplate'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { API, contents, dirEntry, ghRepo, json, npmRoutes, pkg, RAW, raw, repoById, repoByName, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-21T12:00:00Z')
const OFFICIAL = 'payloadcms/payload'
const PAYLOAD_REPO = ghRepo(100, OFFICIAL, { topics: [], stargazers_count: 40_000 })
const COMMUNITY = ghRepo(5, 'a/b', { topics: [], is_template: true, pushed_at: '2026-10-20T08:00:00Z' })

/** Unrouted raw files and GitHub API URLs answer 404 (missing READMEs, commit history, a gone repository). */
const ctxFor = (routes: Record<string, FakeRoute>, readme?: ReadmeRendering) => ({
  ...syncContext(fakeFetch(routes, { notFoundPrefixes: [RAW, API] }), NOW),
  ...(readme ? { readme } : {}),
})

const officialRoutes = (folders = ['blank', 'blank-tanstack', 'website']): Record<string, FakeRoute> => {
  const routes: Record<string, FakeRoute> = {
    [repoById(100)]: json(PAYLOAD_REPO),
    [repoByName(OFFICIAL)]: json(PAYLOAD_REPO),
    [contents(OFFICIAL, 'templates')]: json([dirEntry('_template', 'templates/_template'), ...folders.map((f) => dirEntry(f, `templates/${f}`))]),
    ...npmRoutes('payload', { version: '3.60.0' }),
  }
  for (const f of folders) {
    const dep = f.endsWith('tanstack') ? '@payloadcms/tanstack-start' : '@payloadcms/next'
    routes[raw(OFFICIAL, `templates/${f}/package.json`)] = pkg({ name: f, description: `The ${f} template`, dependencies: { payload: 'workspace:*', [dep]: 'workspace:*' } })
  }
  return routes
}

const COMMUNITY_PKG = { name: 'cool-template', description: 'A cool template', dependencies: { payload: '^3.0.0', '@payloadcms/next': '^3.0.0' } }
const communityRoutes = (over: Partial<typeof COMMUNITY> = {}, readme = '# Cool\n\nA template.', pkgBody: Record<string, unknown> = COMMUNITY_PKG): Record<string, FakeRoute> => {
  const repo = { ...COMMUNITY, ...over }
  return {
    [repoById(5)]: json(repo),
    [repoByName('a/b')]: json(repo),
    [raw('a/b', 'package.json')]: pkg(pkgBody),
    [raw('a/b', 'README.md')]: text(readme),
  }
}
const communityInput: SyncTemplateInput = { fullName: 'a/b', githubId: 5, path: null, source: 'submission' }
const officialInput: SyncTemplateInput = { fullName: OFFICIAL, source: 'official' }

const templates = async (): Promise<Template[]> =>
  (await payload.find({ collection: 'templates', overrideAccess: true, trash: true, depth: 0, limit: 0, pagination: false, sort: 'slug' })).docs
const template = async (slug: string) => (await templates()).find((t) => t.slug === slug)

const jobs = async (taskSlug: string) =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: taskSlug } }, limit: 0, pagination: false })).docs

async function createTemplate(repository: number, over: Partial<Template> = {}): Promise<Template> {
  return payload.create({
    collection: 'templates',
    overrideAccess: true,
    depth: 0,
    context: { skipRevalidate: true },
    data: { slug: `tpl-${Math.random().toString(36).slice(2, 8)}`, name: 'Tpl', repository, url: 'https://github.com/x/y', source: 'submission', ...over } as never,
  })
}

const rendering = (version = 'v1'): ReadmeRendering & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    version: () => version,
    render: async (source) => {
      calls.push(source)
      return source.includes('IMG')
        ? { html: '<p>Shot</p><p><img src="https://raw.githubusercontent.com/a/b/main/shot.png?x=1&amp;y=2" alt="shot"></p><img src="https://raw.githubusercontent.com/a/b/main/second.png">' }
        : { html: `<p>${source.length}</p>` }
    },
  }
}

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterEach(() => setSyncDeps(null))
afterAll(async () => resetDatabase(payload))

describe('runSyncTemplate (official)', () => {
  it('creates one template per official folder and leaves an existing repository row alone', async () => {
    const row = await createRepo(payload, { fullName: OFFICIAL, owner: 'payloadcms', githubId: 100, stars: 999 })
    const r = await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes()))
    expect(r).toMatchObject({ status: 'synced', created: ['blank', 'blank-tanstack', 'website'], trashed: [] })
    expect(r.revalidateTags).toEqual(['templates', 'template:blank', 'template:blank-tanstack', 'template:website'])
    const docs = await templates()
    expect(docs).toHaveLength(3)
    for (const d of docs) {
      expect(d).toMatchObject({
        isOfficial: true, source: 'official', path: `templates/${d.slug}`, repository: row.id, visibility: 'listed',
        firstSeenAt: NOW.toISOString(), payloadVersionRange: 'workspace:*', payloadMajors: ['3'], isTemplateRepo: false,
      })
      expect(d.contentHash).toMatch(/^[0-9a-f]{64}$/)
    }
    expect((await template('blank-tanstack'))!.stackDetected).toBe('tanstack-start')
    expect((await template('website'))!.stackDetected).toBe('nextjs')
    expect(r.contentChanged).toHaveLength(3)
    const repo = await payload.findByID({ collection: 'repositories', id: row.id, overrideAccess: true })
    expect(repo.stars).toBe(999)
  })

  it('creates the official repository row when missing, without marking it synced for sync-repository', async () => {
    await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes()))
    const repo = (await payload.find({ collection: 'repositories', overrideAccess: true, where: { fullName: { equals: OFFICIAL } } })).docs[0]
    expect(repo).toMatchObject({ githubId: 100, stars: 40_000, lastSyncedAt: null, isMonorepo: true })
  })

  it('trashes a folder that disappeared with package-removed and restores it when it comes back', async () => {
    await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes()))
    const r = await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes(['blank', 'blank-tanstack'])))
    expect(r.trashed).toEqual(['website'])
    expect(r.revalidateTags).toContain('template:website')
    const website = await template('website')
    expect(website!.deletedAt).toBeTruthy()
    expect(website!.syncTrashReason).toBe('package-removed')
    expect((await template('blank'))!.deletedAt ?? null).toBeNull()

    const back = await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes()))
    expect(back.updated).toContain('website')
    expect(await template('website')).toMatchObject({ deletedAt: null, syncTrashReason: null })
  })

  it('never restores a template an admin trashed', async () => {
    await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes()))
    const website = await template('website')
    await payload.update({ collection: 'templates', id: website!.id, overrideAccess: true, context: { skipRevalidate: true }, data: { deletedAt: NOW.toISOString() } })
    await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes()))
    expect((await template('website'))!.deletedAt).toBeTruthy()
  })

  it('never touches official plugins of the shared repository', async () => {
    const row = await createRepo(payload, { fullName: OFFICIAL, owner: 'payloadcms', githubId: 100 })
    await createPlugin(payload, row.id, { slug: 'official-plugin-seo', path: 'packages/plugin-seo', source: 'official', isOfficial: true })
    await runSyncTemplate(payload, officialInput, ctxFor(officialRoutes(['website'])))
    const plugins = (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true })).docs
    expect(plugins.map((p) => [p.slug, p.deletedAt ?? null])).toEqual([['official-plugin-seo', null]])
  })
})

describe('runSyncTemplate (community)', () => {
  it('creates <id>-root with the repository row; a 404 later trashes it as repository-gone', async () => {
    const r = await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))
    expect(r).toMatchObject({ status: 'synced', created: ['5-root'] })
    const doc = await template('5-root')
    expect(doc).toMatchObject({
      name: 'cool-template', description: 'A cool template', path: null, source: 'submission', isTemplateRepo: true, isOfficial: false,
      stackDetected: 'nextjs', payloadMajors: ['3'], lastUpdatedAt: '2026-10-20T08:00:00.000Z', readme: '# Cool\n\nA template.',
      dependencyNames: ['@payloadcms/next', 'payload'], license: 'MIT', visibility: 'listed',
    })
    const repo = (await payload.find({ collection: 'repositories', overrideAccess: true, where: { githubId: { equals: 5 } } })).docs[0]
    expect(repo).toMatchObject({ fullName: 'a/b', stars: 42 })
    expect(doc!.repository).toBe(repo.id)

    const gone = await runSyncTemplate(payload, communityInput, ctxFor({}))
    expect(gone).toMatchObject({ status: 'gone', trashed: ['5-root'] })
    expect(await template('5-root')).toMatchObject({ syncTrashReason: 'repository-gone' })
    expect((await template('5-root'))!.deletedAt).toBeTruthy()
  })

  it('updates repository stats on re-sync without advancing pushedAt for sync-repository', async () => {
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({ stargazers_count: 77, pushed_at: '2026-10-21T08:00:00Z' })))
    const repo = (await payload.find({ collection: 'repositories', overrideAccess: true, where: { githubId: { equals: 5 } } })).docs[0]
    expect(repo).toMatchObject({ stars: 77, pushedAt: '2026-10-20T08:00:00.000Z', lastSyncedAt: null })
    expect((await template('5-root'))!.lastUpdatedAt).toBe('2026-10-21T08:00:00.000Z')
  })

  it('revalidates the plugins of a repository holding both kinds when the template sync refreshes its row', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5, stars: 1 })
    await createPlugin(payload, row.id, { slug: '5-plugin', path: 'packages/plugin' })
    const sub: SyncTemplateInput = { fullName: 'a/b', githubId: 5, path: 'templates/site', source: 'submission' }
    const routes = (stars: number): Record<string, FakeRoute> => ({
      [repoById(5)]: json({ ...COMMUNITY, stargazers_count: stars }),
      [raw('a/b', 'templates/site/package.json')]: pkg(COMMUNITY_PKG),
    })
    const r = await runSyncTemplate(payload, sub, ctxFor(routes(50)))
    expect(r.created).toEqual(['5-site'])
    expect(r.revalidateTags).toEqual(['templates', 'template:5-site', 'plugins', 'plugin:5-plugin'])
    expect((await payload.findByID({ collection: 'repositories', id: row.id, overrideAccess: true })).stars).toBe(50)
    // Unchanged row: no plugin tags.
    expect((await runSyncTemplate(payload, sub, ctxFor(routes(50)))).revalidateTags).toEqual(['templates', 'template:5-site'])
  })

  it('stores an oversized package.json license clamped instead of failing the sync', async () => {
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({ license: { spdx_id: 'X'.repeat(300) } }, '# r', { ...COMMUNITY_PKG, license: 'L'.repeat(100) })))
    expect((await template('5-root'))!.license).toBe('X'.repeat(200))
  })

  it('returns conflict and writes nothing when a non-trashed plugin holds the same repository and path', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5, stars: 1 })
    await createPlugin(payload, row.id, { slug: '5-root', path: null })
    const r = await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))
    expect(r).toMatchObject({ status: 'conflict', created: [], updated: [], trashed: [], revalidateTags: [] })
    expect(await templates()).toHaveLength(0)
    expect((await payload.findByID({ collection: 'repositories', id: row.id, overrideAccess: true })).stars).toBe(1)
  })

  it('a trashed plugin at the same path is no conflict', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    const p = await createPlugin(payload, row.id, { slug: '5-root', path: null })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, context: { skipRevalidate: true }, data: { deletedAt: NOW.toISOString() } })
    expect((await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))).created).toEqual(['5-root'])
  })

  it('keeps owner-set stackOverride, demoUrl, customTagline and visibility across a re-sync', async () => {
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))
    const doc = await template('5-root')
    await payload.update({
      collection: 'templates', id: doc!.id, overrideAccess: true, context: { skipRevalidate: true },
      data: { stackOverride: 'other', demoUrl: 'https://demo.example.com', customTagline: 'Mine', visibility: 'hidden' },
    })
    const r = await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({}, '# Cool v2', { ...COMMUNITY_PKG, description: 'Now better' })))
    expect(r.updated).toEqual(['5-root'])
    expect(await template('5-root')).toMatchObject({
      description: 'Now better', readme: '# Cool v2', stackOverride: 'other', demoUrl: 'https://demo.example.com/', customTagline: 'Mine', visibility: 'hidden',
    })
  })

  it('reports contentChanged only when the content hash differs from the enriched hash', async () => {
    const first = await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))
    const doc = await template('5-root')
    expect(first.contentChanged).toEqual([doc!.id])
    await payload.update({ collection: 'templates', id: doc!.id, overrideAccess: true, context: { skipRevalidate: true, enrichment: true }, data: { ai: { enrichedHash: doc!.contentHash } } })
    expect((await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes()))).contentChanged).toEqual([])
    expect((await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({}, '# Changed')))).contentChanged).toEqual([doc!.id])
  })

  it('clamps an oversized description and README and flags the truncation', async () => {
    const readme = `# Huge\n${'line of text\n'.repeat(12_000)}`
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({}, readme, { ...COMMUNITY_PKG, description: 'd'.repeat(60_000) })))
    const doc = await template('5-root')
    expect(doc!.description!.length).toBe(2_000)
    expect(doc!.readme!.length).toBeLessThanOrEqual(100_000)
    expect(doc!.readmeTruncated).toBe(true)
  })

  it('stores the first README image of the rendered HTML as fallbackImageUrl', async () => {
    const r = rendering()
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({}, '# IMG readme'), r))
    const doc = await template('5-root')
    expect(doc).toMatchObject({
      fallbackImageUrl: 'https://raw.githubusercontent.com/a/b/main/shot.png?x=1&y=2',
      readmeRenderVersion: readmeStamp('v1', '# IMG readme'),
    })
    expect(doc!.readmeHtml).toContain('shot.png')
    // Unchanged README and version: not rendered again, fallback image kept.
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({}, '# IMG readme'), r))
    expect(r.calls).toHaveLength(1)
    expect((await template('5-root'))!.fallbackImageUrl).toContain('shot.png')
    // A new README without an image clears it.
    await runSyncTemplate(payload, communityInput, ctxFor(communityRoutes({}, '# plain'), r))
    expect((await template('5-root'))!.fallbackImageUrl ?? null).toBeNull()
  })
})

describe('the plugin and template guard in runSyncRepository', () => {
  it('creates no plugin at a path a non-trashed template holds', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    await createTemplate(row.id, { slug: '5-root', path: null })
    const r = await runSyncRepository(payload, { fullName: 'a/b', githubId: 5, source: 'topic' }, ctxFor({
      [repoById(5)]: json({ ...COMMUNITY, topics: ['payload-plugin'] }),
      [raw('a/b', 'package.json')]: pkg({ name: 'ab', peerDependencies: { payload: '^3.0.0' } }),
    }))
    expect(r).toMatchObject({ status: 'synced', created: [] })
    expect((await payload.find({ collection: 'plugins', overrideAccess: true, trash: true })).docs).toHaveLength(0)
    expect((await template('5-root'))!.deletedAt ?? null).toBeNull()
  })

  it('still creates the plugin when the template at that path is trashed', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    await createTemplate(row.id, { slug: '5-root', path: null, deletedAt: NOW.toISOString() } as never)
    const r = await runSyncRepository(payload, { fullName: 'a/b', githubId: 5, source: 'topic' }, ctxFor({
      [repoById(5)]: json({ ...COMMUNITY, topics: ['payload-plugin'] }),
      [raw('a/b', 'package.json')]: pkg({ name: 'ab', peerDependencies: { payload: '^3.0.0' } }),
    }))
    expect(r.created).toEqual(['5-root'])
  })
})

describe('runDiscoverTemplates', () => {
  it('returns the official input first and once, then community and converted templates, deduplicated, skipping trashed ones', async () => {
    const official = await createRepo(payload, { fullName: OFFICIAL, owner: 'payloadcms', githubId: 100 })
    const ab = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    const cd = await createRepo(payload, { fullName: 'c/d', owner: 'c', githubId: 6 })
    await createTemplate(official.id, { slug: 'website', path: 'templates/website', source: 'official', isOfficial: true })
    await createTemplate(official.id, { slug: '100-root', path: null, source: 'submission' })
    await createTemplate(ab.id, { slug: '5-root', path: null, source: 'submission' })
    await createTemplate(ab.id, { slug: '5-sub', path: 'apps/web', source: 'converted' })
    await createTemplate(ab.id, { slug: '5-dupe', path: 'apps/web', source: 'submission' })
    await createTemplate(cd.id, { slug: '6-root', path: null, source: 'submission', deletedAt: NOW.toISOString() } as never)

    const inputs = await runDiscoverTemplates(payload)
    expect(inputs).toEqual([
      { fullName: OFFICIAL, githubId: 100, path: null, source: 'official' },
      { fullName: 'a/b', githubId: 5, path: null, source: 'submission' },
      { fullName: 'a/b', githubId: 5, path: 'apps/web', source: 'converted' },
    ])
  })

  it('returns the official input even with no templates yet', async () => {
    expect(await runDiscoverTemplates(payload)).toEqual([{ fullName: OFFICIAL, githubId: null, path: null, source: 'official' }])
  })
})

describe('template jobs', () => {
  it('registers discover-templates (scheduled) and sync-template (sync queue, per-template concurrency key)', async () => {
    const tasks = payload.config.jobs.tasks ?? []
    const discover = tasks.find((t) => t.slug === 'discover-templates')!
    const sync = tasks.find((t) => t.slug === 'sync-template')!
    expect(discover.schedule).toEqual([{ cron: '15 */6 * * *', queue: 'default' }])
    expect(sync.retries).toEqual({ attempts: 3, backoff: { type: 'exponential', delay: 30_000 } })
    const concurrency = sync.concurrency as { key: (a: { input: SyncTemplateInput }) => string; supersedes: boolean }
    expect(concurrency.supersedes).toBe(true)
    expect(concurrency.key({ input: { fullName: 'A/B', path: 'apps/web', source: 'submission' } })).toBe('sync-template:a/b:apps/web')
    expect(concurrency.key({ input: { fullName: 'A/B', source: 'submission' } })).toBe('sync-template:a/b:')
  })

  it('discover-templates queues one sync-template per input on the sync queue', async () => {
    const ab = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    await createTemplate(ab.id, { slug: '5-root', path: null, source: 'submission' })
    await payload.jobs.queue({ task: 'discover-templates', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', limit: 1, overrideAccess: true })
    const queued = await jobs('sync-template')
    expect(queued.map((j) => [j.queue, (j.input as SyncTemplateInput).fullName]).sort()).toEqual([['sync', 'a/b'], ['sync', OFFICIAL]])
  })
})

describe('README rendering for templates', () => {
  it('renderReadmeBatch renders stale templates and stores the fallback image', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5, defaultBranch: 'main' })
    await createTemplate(row.id, { slug: 'with-img', readme: '# IMG' })
    await createTemplate(row.id, { slug: 'plain', readme: '# plain' })
    const r = rendering()
    const res = await renderReadmeBatch(payload, r, { collection: 'templates' })
    expect(res).toMatchObject({ rendered: 2, more: false })
    expect(await template('with-img')).toMatchObject({ fallbackImageUrl: 'https://raw.githubusercontent.com/a/b/main/shot.png?x=1&y=2', readmeRenderVersion: readmeStamp('v1', '# IMG') })
    expect((await template('plain'))!.readmeHtml).toBe('<p>7</p>')
    const revalidate = await jobs('revalidate')
    expect(revalidate.flatMap((j) => (j.input as { tags: string[] }).tags)).toEqual(['templates', 'template:plain', 'template:with-img'])
  })

  it('renderReadmes runs plugins, then templates', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    await createPlugin(payload, row.id, { slug: 'p1', readme: '# plugin' } as never)
    await createTemplate(row.id, { slug: 't1', readme: '# template' })
    const r = rendering()
    expect(await renderReadmes(payload, r)).toMatchObject({ rendered: 2 })
    expect(r.calls).toEqual(['# plugin', '# template'])
  })

  it('the render-readmes job continues with templates after the plugins, then stops', async () => {
    const row = await createRepo(payload, { fullName: 'a/b', owner: 'a', githubId: 5 })
    await createTemplate(row.id, { slug: 'stale', readme: '# IMG stale' })
    const r = rendering()
    setSyncDeps({ readme: r })
    await payload.jobs.queue({ task: 'render-readmes', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', limit: 1, overrideAccess: true })
    const pending = (await jobs('render-readmes')).filter((j) => !j.completedAt)
    expect(pending.map((j) => j.input)).toEqual([expect.objectContaining({ collection: 'templates', afterId: null })])
    expect(r.calls).toEqual([]) // the plugin pass found nothing to render

    await payload.jobs.run({ queue: 'default', limit: 1, overrideAccess: true })
    expect((await jobs('render-readmes')).filter((j) => !j.completedAt)).toEqual([])
    expect(r.calls).toEqual(['# IMG stale'])
    expect(await template('stale')).toMatchObject({ readmeRenderVersion: readmeStamp('v1', '# IMG stale') })
    expect((await template('stale'))!.readmeHtml).toContain('shot.png')
    expect((await template('stale'))!.fallbackImageUrl).toContain('shot.png')
  })

  it('an admin edit of a template README queues a re-render; a sync-style write does not', async () => {
    const row = await createRepo(payload)
    const doc = await createTemplate(row.id, { slug: 'edited', readme: '# one' })
    const before = (await jobs('render-readmes')).length
    await payload.update({ collection: 'templates', id: doc.id, overrideAccess: true, context: { skipRevalidate: true }, data: { readme: '# two' } })
    expect((await jobs('render-readmes')).length).toBe(before)
    await payload.update({ collection: 'templates', id: doc.id, overrideAccess: true, data: { readme: '# three' } })
    expect((await jobs('render-readmes')).length).toBe(before + 1)
  })
})
