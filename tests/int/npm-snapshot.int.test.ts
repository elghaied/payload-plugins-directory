import { afterAll, beforeEach, describe, expect, it } from 'vitest'
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
