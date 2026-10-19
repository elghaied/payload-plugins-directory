import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { eq } from '@payloadcms/db-postgres/drizzle'
import { pluginSnapshots, repositorySnapshots } from '@/db/snapshots'
import type { SyncContext } from '@/sync/context'
import { RateLimitError } from '@/sync/http'
import { runNpmStats } from '@/sync/npmStats'
import { runSnapshot } from '@/sync/snapshot'
import { trashPlugins } from '@/sync/trash'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { DOWNLOADS, npmRoutes, REGISTRY } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { syncContext } from './helpers/syncContext'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')

const ctx = (routes: Record<string, FakeRoute>): SyncContext => syncContext(fakeFetch(routes), NOW)
const bySlug = async (slug: string) =>
  (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: slug } } })).docs[0]

async function fixture() {
  const seoRepo = await createRepo(payload, { fullName: 'acme/seo', githubId: 7, stars: 42, pushedAt: '2026-10-18T09:00:00.000Z', license: 'MIT' })
  const official = await createRepo(payload, { fullName: 'payloadcms/payload', owner: 'payloadcms', stars: 40_000, openIssues: 900 })
  await createPlugin(payload, seoRepo.id, { slug: 's1', packageName: 'payload-seo', payloadVersionRange: '^3.0.0', payloadMajors: ['3'] })
  await createPlugin(payload, official.id, {
    slug: 'official-plugin-seo', packageName: '@payloadcms/plugin-seo', payloadVersionRange: 'workspace:*',
    payloadMajors: ['unknown'], source: 'official', isOfficial: true,
  })
  return { seoRepo, official }
}
const routes = (): Record<string, FakeRoute> => ({
  ...npmRoutes('payload-seo', { version: '1.2.0', weekly: 500 }),
  ...npmRoutes('@payloadcms/plugin-seo', { version: '4.0.0-beta.2', weekly: 20_000 }),
})

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('runNpmStats', () => {
  it('stores npm data, recomputes health and derives workspace majors from the latest version', async () => {
    await fixture()
    const r = await runNpmStats(payload, {}, ctx(routes()))
    expect(r.checked).toBe(2)
    expect([...r.updated].sort()).toEqual(['official-plugin-seo', 's1'])
    expect(r.revalidateTags).toEqual(['plugins', 'plugin:official-plugin-seo', 'plugin:s1'])
    expect(await bySlug('s1')).toMatchObject({
      npm: { weeklyDownloads: 500, monthlyDownloads: 2000, latestVersion: '1.2.0', unpackedSize: 20000, dependencyCount: 0, lastPublish: '2026-10-10T00:00:00.000Z' },
    })
    const official = await bySlug('official-plugin-seo')
    expect(official.payloadMajors).toEqual(['4'])
    expect(official.healthScore).toBeGreaterThan(0)
  })

  it('changes nothing on an unchanged second run', async () => {
    await fixture()
    await runNpmStats(payload, {}, ctx(routes()))
    expect(await runNpmStats(payload, {}, ctx(routes()))).toMatchObject({ updated: [], revalidateTags: [] })
  })

  it('gives a shared package name only to the plugin whose repository npm points at', async () => {
    const one = await createRepo(payload, { fullName: 'acme/one' })
    const two = await createRepo(payload, { fullName: 'acme/two' })
    await createPlugin(payload, one.id, { slug: 'dup-one', packageName: 'payload-dup' })
    await createPlugin(payload, two.id, { slug: 'dup-two', packageName: 'payload-dup' })
    await runNpmStats(payload, {}, ctx(npmRoutes('payload-dup', { repositoryUrl: 'git+https://github.com/acme/two.git' })))
    expect((await bySlug('dup-two')).npm?.latestVersion).toBe('1.2.0')
    expect((await bySlug('dup-one')).npm?.latestVersion ?? null).toBeNull()
  })

  it('limits the run to the given slugs and keeps npm data when the package is gone', async () => {
    await fixture()
    const s1 = await bySlug('s1')
    await payload.update({ collection: 'plugins', id: s1.id, overrideAccess: true, data: { npm: { latestVersion: '1.0.0', weeklyDownloads: 1 } } })
    // No routes for the official package: fetching it would reject.
    const r = await runNpmStats(payload, { slugs: ['s1'] }, ctx({ ...npmRoutes('payload-seo'), [`${REGISTRY}/payload-seo`]: { status: 404 } }))
    expect(r.checked).toBe(1)
    expect((await bySlug('s1')).npm).toMatchObject({ latestVersion: '1.0.0', weeklyDownloads: 1 })
  })

  it('keeps previous npm fields for a plugin whose lookup fails and continues with the others', async () => {
    await fixture()
    const s1 = await bySlug('s1')
    await payload.update({ collection: 'plugins', id: s1.id, overrideAccess: true, data: { healthScore: 33, npm: { latestVersion: '1.0.0', weeklyDownloads: 1 } } })
    const r = await runNpmStats(payload, {}, ctx({ ...routes(), [`${REGISTRY}/payload-seo`]: { status: 500 } }))
    expect(r.failed).toEqual(['s1'])
    expect(r.errors).toBe(1)
    expect(r.updated).toEqual(['official-plugin-seo'])
    expect(await bySlug('s1')).toMatchObject({ healthScore: 33, npm: { latestVersion: '1.0.0', weeklyDownloads: 1 } })
  })

  it('isolates a failing plugin update and records the slug', async () => {
    await fixture()
    const target = await bySlug('s1')
    const real = payload.update.bind(payload)
    const spy = vi.spyOn(payload, 'update').mockImplementation(((args: { id: number }) =>
      args.id === target.id ? Promise.reject(new Error('boom')) : real(args as never)) as never)
    try {
      const r = await runNpmStats(payload, {}, ctx(routes()))
      expect(r.failed).toEqual(['s1'])
      expect(r.errors).toBe(1)
      expect(r.updated).toEqual(['official-plugin-seo'])
    } finally {
      spy.mockRestore()
    }
    expect((await bySlug('official-plugin-seo')).npm?.latestVersion).toBe('4.0.0-beta.2')
  })

  it('records plugins with an invalid package name as failed', async () => {
    const repo = await createRepo(payload, { fullName: 'acme/bad' })
    await createPlugin(payload, repo.id, { slug: 'bad-name', packageName: 'Not A Valid Name!' })
    const r = await runNpmStats(payload, {}, ctx({}))
    expect(r).toMatchObject({ checked: 0, failed: ['bad-name'], errors: 1 })
  })

  it('propagates non-transient errors', async () => {
    await fixture()
    await expect(runNpmStats(payload, {}, ctx({ ...routes(), [`${REGISTRY}/payload-seo`]: () => { throw new RangeError('bug') } }))).rejects.toThrow('bug')
  })

  it('clears npm data of a plugin whose package belongs to another repository', async () => {
    const real = await createRepo(payload, { fullName: 'acme/popular' })
    const fake = await createRepo(payload, { fullName: 'evil/copycat' })
    await createPlugin(payload, fake.id, { slug: 'impostor', packageName: 'popular-pkg', npm: { latestVersion: '9.9.9', weeklyDownloads: 999_999 } })
    const r = await runNpmStats(payload, {}, ctx(npmRoutes('popular-pkg', { repositoryUrl: 'git+https://github.com/acme/popular.git' })))
    expect(r.mismatched).toEqual(['impostor'])
    expect(await bySlug('impostor')).toMatchObject({ npm: { latestVersion: null, weeklyDownloads: null } })
    await createPlugin(payload, real.id, { slug: 'owner', packageName: 'popular-pkg2' })
    const r2 = await runNpmStats(payload, { slugs: ['owner'] }, ctx(npmRoutes('popular-pkg2', { repositoryUrl: 'https://github.com/Acme/Popular' })))
    expect(r2.mismatched).toEqual([])
    expect((await bySlug('owner')).npm?.latestVersion).toBe('1.2.0')
  })

  it('treats a non-GitHub registry repository as a mismatch', async () => {
    const repo = await createRepo(payload, { fullName: 'acme/solo' })
    await createPlugin(payload, repo.id, { slug: 'solo', packageName: 'solo-pkg', npm: { latestVersion: '1.0.0', weeklyDownloads: 5 } })
    const r = await runNpmStats(payload, {}, ctx(npmRoutes('solo-pkg', { repositoryUrl: 'git+https://gitlab.com/x/y.git' })))
    expect(r.mismatched).toEqual(['solo'])
    expect(await bySlug('solo')).toMatchObject({ npm: { latestVersion: null, weeklyDownloads: null } })
  })

  it('assigns data for an official monorepo registry entry with a directory', async () => {
    const { official } = await fixture()
    const r = routes()
    const key = `${REGISTRY}/${encodeURIComponent('@payloadcms/plugin-seo')}`
    const doc = (r[key] as { json: { versions: Record<string, Record<string, unknown>> } }).json
    doc.versions['4.0.0-beta.2'].repository = { type: 'git', url: 'https://github.com/payloadcms/payload.git', directory: 'packages/plugin-seo' }
    const res = await runNpmStats(payload, { slugs: ['official-plugin-seo'] }, ctx(r))
    expect(official.fullName).toBe('payloadcms/payload')
    expect(res.mismatched).toEqual([])
    expect((await bySlug('official-plugin-seo')).npm?.weeklyDownloads).toBe(20_000)
  })

  it('assigns data when the registry has no repository and one plugin uses the name', async () => {
    await fixture()
    const r = await runNpmStats(payload, { slugs: ['s1'] }, ctx(npmRoutes('payload-seo')))
    expect(r.mismatched).toEqual([])
    expect((await bySlug('s1')).npm?.weeklyDownloads).toBe(500)
  })

  it('turns a rate limit into a re-queue of the slugs not yet fetched', async () => {
    await fixture()
    const err = await runNpmStats(payload, {}, ctx({ ...routes(), [`${DOWNLOADS}/last-week/payload-seo`]: { status: 429 } })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect([...((err as RateLimitError).requeueInput?.slugs as string[])].sort()).toEqual(['official-plugin-seo', 's1'])
  })
})

describe('runSnapshot', () => {
  it('upserts one row per active repository and plugin, overwriting on a same-day re-run', async () => {
    const { seoRepo } = await fixture()
    expect(await runSnapshot(payload, NOW)).toEqual({ date: '2026-10-19', repositories: 2, plugins: 2 })
    await payload.update({ collection: 'repositories', id: seoRepo.id, overrideAccess: true, data: { stars: 50 } })
    await runSnapshot(payload, NOW)
    const rows = await payload.db.drizzle.select().from(repositorySnapshots).where(eq(repositorySnapshots.repositoryId, seoRepo.id))
    expect(rows).toEqual([{ repositoryId: seoRepo.id, date: '2026-10-19', stars: 50, forks: 0, openIssues: 0 }])
    expect(await payload.db.drizzle.select().from(pluginSnapshots)).toHaveLength(2)
    const s1 = await bySlug('s1')
    await payload.update({ collection: 'plugins', id: s1.id, overrideAccess: true, data: { healthScore: 77, npm: { weeklyDownloads: 1234, latestVersion: '1.0.0' } } })
    await runSnapshot(payload, NOW)
    const pr = await payload.db.drizzle.select().from(pluginSnapshots).where(eq(pluginSnapshots.pluginId, s1.id))
    expect(pr).toEqual([{ pluginId: s1.id, date: '2026-10-19', weeklyDownloads: 1234, healthScore: 77 }])
  })

  it('skips trashed plugins and repositories that only have trashed plugins', async () => {
    const { official } = await fixture()
    await trashPlugins(payload, { repository: { equals: official.id } }, 'repository-gone', NOW)
    expect(await runSnapshot(payload, NOW)).toEqual({ date: '2026-10-19', repositories: 1, plugins: 1 })
  })
  it('writes NULL for unknown weekly downloads', async () => {
    await fixture()
    await runSnapshot(payload, NOW)
    const rows = await payload.db.drizzle.select().from(pluginSnapshots)
    expect(rows.every((r) => r.weeklyDownloads === null)).toBe(true)
  })
})
