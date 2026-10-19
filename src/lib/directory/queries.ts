import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { LIST_TAG, pluginTag } from '@/lib/cacheTags'
import { toDetail, toSummary } from './mappers'
import type { PluginDetail, PluginSummary } from './types'

const SUMMARY_SELECT = {
  slug: true, name: true, packageName: true, description: true, url: true, isOfficial: true,
  payloadMajors: true, healthScore: true, npm: true, repository: true,
} as const

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
      })
      return res.docs[0] ? toDetail(res.docs[0]) : null
    },
    ['plugin-detail', slug],
    { tags: [LIST_TAG, pluginTag(slug)], revalidate: 3600 },
  )()
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
