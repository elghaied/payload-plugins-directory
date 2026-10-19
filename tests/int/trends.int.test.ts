import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import fixture from '../fixtures/legacy-plugins.json'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { clearSnapshots, daily, insertPluginSnapshots, insertRepoSnapshots } from './helpers/snapshots'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'
import { seedDirectory } from '@/cli/seed'
import { addDays, utcToday } from '@/lib/trends/days'

const cacheKeys = vi.hoisted(() => [] as string[][])
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, keyParts: string[]) => {
    cacheKeys.push(keyParts)
    return fn
  },
}))

// Fixture roles:
//   ashbuilds/payload-ai     → 829724738-root (TRASHED: its repo backs no listed plugin)
//   r1tsuu/payload-enchants  → 684372049-better-localized-fields (listed, no npm) + 684372049-translator (HIDDEN)
//   payloadcms/payload       → official-plugin-form-builder + official-plugin-seo (both listed: monorepo)
const ORPHAN_PLUGIN = 999998
const ORPHAN_REPO = 999999
const today = utcToday()
const weekStart = addDays(today, -7)

let payload: Payload
const pluginId: Record<string, number> = {}
const repoId: Record<string, number> = {}

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await seedDirectory(payload, mapLegacy(fixture as LegacyPluginsData, ['684372049-translator']))
  const repos = await payload.find({ collection: 'repositories', overrideAccess: true, limit: 0, pagination: false, depth: 0 })
  for (const r of repos.docs) repoId[r.fullName] = r.id
  await payload.create({
    collection: 'plugins',
    overrideAccess: true,
    data: {
      slug: 'official-plugin-seo', name: 'seo', repository: repoId['payloadcms/payload'],
      url: 'https://github.com/payloadcms/payload/tree/main/packages/plugin-seo',
      isOfficial: true, source: 'official', visibility: 'listed', firstSeenAt: new Date().toISOString(),
    },
  })
  const plugins = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, limit: 0, pagination: false, depth: 0 })
  for (const p of plugins.docs) pluginId[p.slug] = p.id
  // The seed day becomes 60 days ago for the two listed seeded plugins; seo is "newly listed" today.
  // Translator (hidden) and root (trashed) keep today's firstSeenAt: they must still not show up as new.
  for (const slug of ['684372049-better-localized-fields', 'official-plugin-form-builder']) {
    await payload.update({
      collection: 'plugins', id: pluginId[slug], overrideAccess: true,
      data: { firstSeenAt: `${addDays(today, -60)}T12:00:00.000Z` },
    })
  }
  await payload.update({
    collection: 'plugins', id: pluginId['829724738-root'], overrideAccess: true,
    data: { deletedAt: new Date().toISOString() },
  })
})
afterAll(async () => resetDatabase(payload))
beforeEach(async () => clearSnapshots(payload))

async function queries() {
  return import('@/lib/trends/queries')
}

async function seedWeek() {
  const days = (start: number, step: number) => daily(weekStart, Array.from({ length: 8 }, (_, i) => start + i * step))
  await insertRepoSnapshots(payload, repoId['payloadcms/payload'], days(45000, 10)) // +70
  await insertRepoSnapshots(payload, repoId['r1tsuu/payload-enchants'], days(300, 1)) // +7
  await insertRepoSnapshots(payload, repoId['ashbuilds/payload-ai'], days(900, 1000)) // trashed-only repo
  await insertRepoSnapshots(payload, ORPHAN_REPO, days(0, 5000)) // deleted repo
  await insertPluginSnapshots(payload, pluginId['official-plugin-form-builder'], days(50000, 100)) // +700
  await insertPluginSnapshots(payload, pluginId['684372049-translator'], days(0, 100000)) // hidden
  await insertPluginSnapshots(payload, pluginId['829724738-root'], days(100, 90000)) // trashed
  await insertPluginSnapshots(payload, ORPHAN_PLUGIN, days(0, 1_000_000)) // hard-deleted
  await insertPluginSnapshots(payload, pluginId['684372049-better-localized-fields'], daily(weekStart, Array(8).fill(null)))
}

describe('trend queries', () => {
  it('with empty snapshot tables: insufficient data, no rankings, but new/recent lists still work', async () => {
    const { getTrendingData, getEcosystemGrowth, getPluginTrends } = await queries()
    const data = await getTrendingData()
    expect(data.starsCoverage).toMatchObject({ daysCollected: 0, ready: false })
    expect(data.downloadsCoverage).toMatchObject({ daysCollected: 0, ready: false })
    expect(data.stars).toEqual([])
    expect(data.downloads).toEqual([])
    expect(data.newThisMonth.map((n) => n.slug)).toEqual(['official-plugin-seo'])
    const recent = data.recentlyUpdated.map((r) => r.fullName)
    expect(recent.filter((n) => n === 'payloadcms/payload')).toHaveLength(1)
    expect(recent).not.toContain('ashbuilds/payload-ai')
    const enchants = data.recentlyUpdated.find((r) => r.fullName === 'r1tsuu/payload-enchants')
    expect(enchants?.plugins.map((p) => p.slug)).toEqual(['684372049-better-localized-fields'])
    expect(data.lastSnapshotDay).toBeNull()
    expect(await getEcosystemGrowth()).toEqual({ stars: [], downloads: [], lastSnapshotDay: null })
    expect(await getPluginTrends('official-plugin-seo')).toEqual({
      stars: [], downloads: [], sharedRepository: { fullName: 'payloadcms/payload', pluginCount: 2 },
    })
  })

  it('with one day of data: still not ready, nothing ranked', async () => {
    await insertRepoSnapshots(payload, repoId['payloadcms/payload'], daily(today, [45000]))
    await insertPluginSnapshots(payload, pluginId['official-plugin-form-builder'], daily(today, [50000]))
    const { getTrendingData, getEcosystemGrowth } = await queries()
    const data = await getTrendingData()
    expect(data.starsCoverage).toMatchObject({ daysCollected: 1, spanDays: 0, ready: false })
    expect(data.lastSnapshotDay).toBe(today)
    expect(data.stars).toEqual([])
    expect(data.downloads).toEqual([])
    expect((await getEcosystemGrowth()).stars).toEqual([{ date: today, value: 45000 }])
  })

  it('ranks star growth once per repository and never leaks hidden, trashed or deleted entries', async () => {
    await seedWeek()
    const { getTrendingData } = await queries()
    const data = await getTrendingData()
    expect(data.starsCoverage).toMatchObject({ daysCollected: 8, ready: true, lastDay: today })
    expect(data.lastSnapshotDay).toBe(today)
    expect(data.stars.map((m) => [m.fullName, m.growth.delta])).toEqual([
      ['payloadcms/payload', 70],
      ['r1tsuu/payload-enchants', 7],
    ])
    expect(data.stars[0].plugins.map((p) => p.slug)).toEqual(['official-plugin-form-builder', 'official-plugin-seo'])
    expect(data.stars[1].plugins.map((p) => p.slug)).toEqual(['684372049-better-localized-fields'])
    expect(data.downloads.map((m) => [m.slug, m.growth.delta])).toEqual([['official-plugin-form-builder', 700]])
  })

  it('totals each listed repository once and excludes unlisted plugins from download totals', async () => {
    await seedWeek()
    const { getEcosystemGrowth } = await queries()
    const growth = await getEcosystemGrowth()
    expect(growth.stars).toHaveLength(8)
    expect(growth.stars.at(-1)).toEqual({ date: today, value: 45070 + 307 })
    expect(growth.downloads.at(-1)).toEqual({ date: today, value: 50700 })
  })

  it('returns per-plugin trends for listed plugins only, as UTC day strings, without caching misses', async () => {
    await seedWeek()
    const { getPluginTrends } = await queries()
    const seo = await getPluginTrends('official-plugin-seo')
    expect(seo?.stars).toHaveLength(8)
    for (const p of seo!.stars) expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(seo?.stars.at(-1)?.date).toBe(today)
    expect(seo?.downloads).toEqual([])
    expect((await getPluginTrends('official-plugin-form-builder'))?.downloads.at(-1)).toEqual({ date: today, value: 50700 })
    expect((await getPluginTrends('684372049-better-localized-fields'))?.sharedRepository).toBeNull()

    cacheKeys.length = 0
    for (const slug of ['684372049-translator', '829724738-root', 'does-not-exist']) {
      expect(await getPluginTrends(slug)).toBeNull()
    }
    expect(cacheKeys.filter((k) => k[0] === 'plugin-trends')).toEqual([])
  })

  it('stale snapshots: ranks as of the last snapshot day and exposes it', async () => {
    const staleStart = addDays(today, -30)
    const days = (start: number, step: number) => daily(staleStart, Array.from({ length: 8 }, (_, i) => start + i * step))
    await insertRepoSnapshots(payload, repoId['payloadcms/payload'], days(45000, 10))
    await insertPluginSnapshots(payload, pluginId['official-plugin-form-builder'], days(50000, 100))
    const { getTrendingData, getEcosystemGrowth } = await queries()
    const lastDay = addDays(staleStart, 7)
    const data = await getTrendingData()
    expect(data.today).toBe(today)
    expect(data.lastSnapshotDay).toBe(lastDay)
    expect(data.starsCoverage).toMatchObject({ ready: true, lastDay })
    expect(data.stars.map((m) => [m.fullName, m.growth.delta])).toEqual([['payloadcms/payload', 70]])
    expect(data.downloads.map((m) => [m.slug, m.growth.delta])).toEqual([['official-plugin-form-builder', 700]])
    expect((await getEcosystemGrowth()).lastSnapshotDay).toBe(lastDay)
  })
})
