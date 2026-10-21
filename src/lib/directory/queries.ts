import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { LIST_TAG, pluginTag } from '@/lib/cacheTags'
import { SUMMARY_SELECT, toDetail, toSummary } from './mappers'
import { stampMatchesText } from './readmeStamp'
import { rankSimilar } from './similar'
import type { PluginDetail, PluginSummary } from './types'

async function payload() {
  return getPayload({ config: await config })
}

export const getPluginSummaries = unstable_cache(
  async (): Promise<PluginSummary[]> => {
    const p = await payload()
    const res = await p.find({
      collection: 'plugins',
      overrideAccess: false,
      user: null,
      depth: 1,
      limit: 0,
      pagination: false,
      select: SUMMARY_SELECT,
      // No `populate`: in this beta a populate select either keeps `category` as a bare id or truncates _h_slugPath
      // to the category's own slug (parent not selected). Unrestricted depth-1 population yields the real path.
      context: { computeHierarchyPaths: true },
      sort: '-healthScore',
    })
    return res.docs.map((doc) => toSummary(doc as never))
  },
  ['plugin-summaries'],
  { tags: [LIST_TAG], revalidate: 3600 },
)

export async function getPluginDetail(slug: string): Promise<PluginDetail | null> {
  // Only slugs of listed plugins reach the per-slug cache: a crawler probing random slugs must not
  // create one cache entry per miss. getPluginSummaries() is already cached and has every listed slug.
  const summaries = await getPluginSummaries()
  if (!summaries.some((s) => s.slug === slug)) return null
  return unstable_cache(
    async () => {
      const p = await payload()
      const res = await p.find({
        collection: 'plugins',
        overrideAccess: false,
        user: null,
        depth: 1,
        limit: 1,
        where: { slug: { equals: slug } },
        context: { computeHierarchyPaths: true },
      })
      const doc = res.docs[0]
      if (!doc) return null
      // readmeHtml has admin-only field access (never in the public API): read it here, server side, for a plugin
      // the access-controlled query above has already shown to be listed.
      const html = await p.findByID({ collection: 'plugins', id: doc.id, overrideAccess: true, depth: 0, select: { readmeHtml: true, readmeRenderVersion: true, readme: true } })
      const detail = toDetail(doc)
      // HTML rendered from different text (the README was edited since) is stale: show the plain text instead.
      return html.readmeHtml && stampMatchesText(html.readmeRenderVersion, html.readme)
        ? { ...detail, readmeHtml: html.readmeHtml, ...(html.readmeRenderVersion ? { readmeRenderVersion: html.readmeRenderVersion } : {}) }
        : detail
    },
    ['plugin-detail', slug],
    { tags: [LIST_TAG, pluginTag(slug)], revalidate: 3600 },
  )()
}

/**
 * Listed plugins similar to `slug` (same category, shared tags), ranked from the cached summaries:
 * no extra query and no per-slug cache entry. [] for an unknown or unlisted slug.
 */
export async function getSimilarPlugins(slug: string, limit = 6): Promise<PluginSummary[]> {
  const summaries = await getPluginSummaries()
  const target = summaries.find((s) => s.slug === slug)
  if (!target) return []
  const bySlug = new Map(summaries.map((s) => [s.slug, s]))
  return rankSimilar(target, summaries, limit).flatMap((s) => bySlug.get(s) ?? [])
}

export const getDirectoryMeta = unstable_cache(
  async () => {
    const p = await payload()
    const [count, latest] = await Promise.all([
      p.count({ collection: 'plugins', overrideAccess: false, user: null }),
      p.find({ collection: 'repositories', overrideAccess: true, sort: '-lastSyncedAt', limit: 1, depth: 0 }),
    ])
    const lastUpdated = latest.docs[0]?.lastSyncedAt ?? latest.docs[0]?.updatedAt ?? new Date().toISOString()
    return { lastUpdated, totalCount: count.totalDocs }
  },
  ['directory-meta'],
  { tags: [LIST_TAG], revalidate: 3600 },
)
