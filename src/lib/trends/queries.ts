import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { and, gte, inArray, isNotNull, sql } from '@payloadcms/db-postgres/drizzle'
import { pluginSnapshots, repositorySnapshots } from '@/db/snapshots'
import { LIST_TAG, pluginTag, SNAPSHOT_TAGS } from '@/lib/cacheTags'
import { addDays, asDay, utcToday, type Day } from './days'
import {
  BASELINE_TOLERANCE_DAYS, coverage, ecosystemSeries, groupSeries, growthOverWindow, HISTORY_DAYS, TREND_WINDOW_DAYS, type Point,
} from './growth'
import { newThisMonth, rankDownloadGrowth, rankStarGrowth, recentlyUpdated } from './rank'
import { toListedRef } from './refs'
import type { EcosystemGrowth, ListedPluginRef, PluginTrends, TrendingData } from './types'

// VISIBILITY RULE: every snapshot read below is restricted to IDs from getListedPluginRefs(), which reads
// plugins through access control as an anonymous user. Snapshot rows have no FK, so rows of hidden,
// trashed or hard-deleted plugins (and of repositories that back none) are excluded by construction.
// SIZE RULE: every raw read is bounded by HISTORY_DAYS; the trending ranking only pulls the few days it compares.

const REVALIDATE = 3600
const [TRENDING_TAG, STATS_TAG] = SNAPSHOT_TAGS

async function payload() {
  return getPayload({ config: await config })
}

async function db() {
  return (await payload()).db.drizzle
}

export const getListedPluginRefs = unstable_cache(
  async (): Promise<ListedPluginRef[]> => {
    const p = await payload()
    const res = await p.find({
      collection: 'plugins',
      overrideAccess: false,
      user: null,
      depth: 1,
      limit: 0,
      pagination: false,
      select: { slug: true, name: true, isOfficial: true, firstSeenAt: true, repository: true },
      populate: { repositories: { fullName: true, owner: true, ownerAvatar: true, pushedAt: true, githubCreatedAt: true } },
    })
    return res.docs.map((doc) => toListedRef(doc as never))
  },
  ['listed-plugin-refs'],
  { tags: [LIST_TAG], revalidate: REVALIDATE },
)

const unique = (ids: number[]) => [...new Set(ids)]
const later = (a: Day | null, b: Day | null): Day | null => (a && b ? (a > b ? a : b) : (a ?? b))

async function starDays(repoIds: number[], since: Day): Promise<Day[]> {
  if (repoIds.length === 0) return []
  const rows = await (await db())
    .selectDistinct({ date: repositorySnapshots.date })
    .from(repositorySnapshots)
    .where(and(inArray(repositorySnapshots.repositoryId, repoIds), gte(repositorySnapshots.date, since)))
  return rows.map((r) => asDay(r.date))
}

async function downloadDays(pluginIds: number[], since: Day): Promise<Day[]> {
  if (pluginIds.length === 0) return []
  const rows = await (await db())
    .selectDistinct({ date: pluginSnapshots.date })
    .from(pluginSnapshots)
    .where(
      and(
        inArray(pluginSnapshots.pluginId, pluginIds),
        gte(pluginSnapshots.date, since),
        isNotNull(pluginSnapshots.weeklyDownloads),
      ),
    )
  return rows.map((r) => asDay(r.date))
}

/** Any row at all, any date: tells a long stall ("out of date") from "never started". Restricted to the listed ids. */
async function hasStarSnapshots(repoIds: number[]): Promise<boolean> {
  if (repoIds.length === 0) return false
  const rows = await (await db()).select({ id: repositorySnapshots.repositoryId }).from(repositorySnapshots)
    .where(inArray(repositorySnapshots.repositoryId, repoIds)).limit(1)
  return rows.length > 0
}

async function hasDownloadSnapshots(pluginIds: number[]): Promise<boolean> {
  if (pluginIds.length === 0) return false
  const rows = await (await db()).select({ id: pluginSnapshots.pluginId }).from(pluginSnapshots)
    .where(and(inArray(pluginSnapshots.pluginId, pluginIds), isNotNull(pluginSnapshots.weeklyDownloads))).limit(1)
  return rows.length > 0
}

async function starRows(repoIds: number[], since: Day) {
  if (repoIds.length === 0) return []
  return (await db())
    .select({ id: repositorySnapshots.repositoryId, date: repositorySnapshots.date, value: repositorySnapshots.stars })
    .from(repositorySnapshots)
    .where(and(inArray(repositorySnapshots.repositoryId, repoIds), gte(repositorySnapshots.date, since)))
}

async function downloadRows(pluginIds: number[], since: Day) {
  if (pluginIds.length === 0) return []
  return (await db())
    .select({ id: pluginSnapshots.pluginId, date: pluginSnapshots.date, value: pluginSnapshots.weeklyDownloads })
    .from(pluginSnapshots)
    .where(
      and(
        inArray(pluginSnapshots.pluginId, pluginIds),
        gte(pluginSnapshots.date, since),
        isNotNull(pluginSnapshots.weeklyDownloads),
      ),
    )
}

/** Rows needed to rank as of `asOf`: the day itself plus the baseline window and its tolerance. */
const rankingSince = (asOf: Day) => addDays(asOf, -(TREND_WINDOW_DAYS + BASELINE_TOLERANCE_DAYS))

async function loadTrending(today: Day): Promise<TrendingData> {
  const refs = await getListedPluginRefs()
  const since = addDays(today, -HISTORY_DAYS)
  const repoIds = unique(refs.map((r) => r.repository.id))
  const pluginIds = refs.map((r) => r.id)
  const [sDays, dDays] = await Promise.all([starDays(repoIds, since), downloadDays(pluginIds, since)])
  const [starsOutdated, downloadsOutdated] = await Promise.all([
    sDays.length === 0 ? hasStarSnapshots(repoIds) : false,
    dDays.length === 0 ? hasDownloadSnapshots(pluginIds) : false,
  ])
  const starsCoverage = { ...coverage(sDays), ...(starsOutdated ? { outdated: true } : {}) }
  const downloadsCoverage = { ...coverage(dDays), ...(downloadsOutdated ? { outdated: true } : {}) }
  // Rank as of the last snapshot day present, not today, so a stalled snapshot job degrades to "data as of".
  const [starRowsData, downloadRowsData] = await Promise.all([
    starsCoverage.ready && starsCoverage.lastDay ? starRows(repoIds, rankingSince(starsCoverage.lastDay)) : [],
    downloadsCoverage.ready && downloadsCoverage.lastDay ? downloadRows(pluginIds, rankingSince(downloadsCoverage.lastDay)) : [],
  ])
  const starSeries = groupSeries(starRowsData)
  const downloadSeries = groupSeries(downloadRowsData)
  const comparable = (series: Map<number, Point[]>, asOf: Day | null) =>
    asOf !== null && [...series.values()].some((s) => growthOverWindow(s, asOf) !== null)
  return {
    today,
    lastSnapshotDay: later(starsCoverage.lastDay, downloadsCoverage.lastDay),
    starsCoverage,
    downloadsCoverage,
    starsComparable: comparable(starSeries, starsCoverage.lastDay),
    downloadsComparable: comparable(downloadSeries, downloadsCoverage.lastDay),
    stars: starsCoverage.ready ? rankStarGrowth(refs, starSeries, starsCoverage.lastDay) : [],
    downloads: downloadsCoverage.ready ? rankDownloadGrowth(refs, downloadSeries, downloadsCoverage.lastDay) : [],
    newThisMonth: newThisMonth(refs, today),
    recentlyUpdated: recentlyUpdated(refs),
  }
}

export const getTrendingData = unstable_cache(async () => loadTrending(utcToday()), ['trending-data'], {
  tags: [TRENDING_TAG, LIST_TAG],
  revalidate: REVALIDATE,
})

export async function getPluginTrends(slug: string): Promise<PluginTrends | null> {
  // Resolve against the listed set first: unknown/hidden/trashed slugs return null and never get a cache entry.
  const refs = await getListedPluginRefs()
  const ref = refs.find((r) => r.slug === slug)
  if (!ref) return null
  const pluginCount = refs.filter((r) => r.repository.id === ref.repository.id).length
  return unstable_cache(
    async (): Promise<PluginTrends> => {
      const since = addDays(utcToday(), -HISTORY_DAYS)
      const [stars, downloads] = await Promise.all([starRows([ref.repository.id], since), downloadRows([ref.id], since)])
      const [starsOutdated, downloadsOutdated] = await Promise.all([
        stars.length === 0 ? hasStarSnapshots([ref.repository.id]) : false,
        downloads.length === 0 ? hasDownloadSnapshots([ref.id]) : false,
      ])
      return {
        stars: groupSeries(stars).get(ref.repository.id) ?? [],
        downloads: groupSeries(downloads).get(ref.id) ?? [],
        sharedRepository: pluginCount > 1 ? { fullName: ref.repository.fullName, pluginCount } : null,
        outdated: { stars: starsOutdated, downloads: downloadsOutdated },
      }
    },
    ['plugin-trends', slug, String(ref.id), String(ref.repository.id), String(pluginCount)],
    { tags: [TRENDING_TAG, LIST_TAG, pluginTag(slug)], revalidate: REVALIDATE },
  )()
}

export const getEcosystemGrowth = unstable_cache(
  async (): Promise<EcosystemGrowth> => {
    const refs = await getListedPluginRefs()
    const repoIds = unique(refs.map((r) => r.repository.id))
    const pluginIds = refs.map((r) => r.id)
    const since = addDays(utcToday(), -HISTORY_DAYS)
    const d = await db()
    // Count the summed column, not `*`: ecosystemSeries needs the number of entities that actually reported.
    const [starTotals, downloadTotals] = await Promise.all([
      repoIds.length === 0
        ? []
        : d
            .select({
              date: repositorySnapshots.date,
              total: sql<string>`sum(${repositorySnapshots.stars})`,
              reporting: sql<string>`count(${repositorySnapshots.stars})`,
            })
            .from(repositorySnapshots)
            .where(and(inArray(repositorySnapshots.repositoryId, repoIds), gte(repositorySnapshots.date, since)))
            .groupBy(repositorySnapshots.date),
      pluginIds.length === 0
        ? []
        : d
            .select({
              date: pluginSnapshots.date,
              total: sql<string>`sum(${pluginSnapshots.weeklyDownloads})`,
              reporting: sql<string>`count(${pluginSnapshots.weeklyDownloads})`,
            })
            .from(pluginSnapshots)
            .where(
              and(
                inArray(pluginSnapshots.pluginId, pluginIds),
                gte(pluginSnapshots.date, since),
                isNotNull(pluginSnapshots.weeklyDownloads),
              ),
            )
            .groupBy(pluginSnapshots.date),
    ])
    const [starsOutdated, downloadsOutdated] = await Promise.all([
      starTotals.length === 0 ? hasStarSnapshots(repoIds) : false,
      downloadTotals.length === 0 ? hasDownloadSnapshots(pluginIds) : false,
    ])
    const stars = ecosystemSeries(starTotals)
    const downloads = ecosystemSeries(downloadTotals)
    return {
      stars,
      downloads,
      lastSnapshotDay: later(stars.at(-1)?.date ?? null, downloads.at(-1)?.date ?? null),
      outdated: { stars: starsOutdated, downloads: downloadsOutdated },
    }
  },
  ['ecosystem-growth'],
  { tags: [STATS_TAG, LIST_TAG], revalidate: REVALIDATE },
)
