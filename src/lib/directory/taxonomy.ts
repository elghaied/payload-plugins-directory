import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { LIST_TAG } from '@/lib/cacheTags'
import { toCategoryNodes, type CategoryNode } from '@/taxonomy/tree'
import {
  buildCategoryOptions, buildTagOptions, categoryPageData, type CategoryOption, type CategoryPageData, type TagOption,
} from './filters'
import { getPluginSummaries } from './queries'

async function payload() {
  return getPayload({ config: await config })
}

/** The whole category tree (anyone may read categories). Carries LIST_TAG: revalidating `plugins` refreshes it. */
export const getCategoryNodes = unstable_cache(
  async (): Promise<CategoryNode[]> => {
    const res = await (await payload()).find({
      collection: 'categories',
      context: { computeHierarchyPaths: true },
      overrideAccess: false,
      user: null,
      depth: 0,
      limit: 0,
      pagination: false,
      select: { title: true, slug: true, intro: true, icon: true, parent: true, _h_slugPath: true },
    })
    return toCategoryNodes(res.docs as never)
  },
  ['category-nodes'],
  { tags: [LIST_TAG], revalidate: 3600 },
)

export const getTagList = unstable_cache(
  async (): Promise<{ slug: string; title: string }[]> => {
    const res = await (await payload()).find({
      collection: 'tags',
      overrideAccess: false,
      user: null,
      depth: 0,
      limit: 0,
      pagination: false,
      sort: 'title',
      select: { slug: true, title: true },
    })
    return res.docs.map((t) => ({ slug: t.slug, title: t.title }))
  },
  ['tag-list'],
  { tags: [LIST_TAG], revalidate: 3600 },
)

/** Categories with subtree counts of listed plugins (index page, sitemap, home filter). */
export async function getCategoryIndex(): Promise<CategoryOption[]> {
  const [nodes, plugins] = await Promise.all([getCategoryNodes(), getPluginSummaries()])
  return buildCategoryOptions(nodes, plugins)
}

/**
 * A category page from cached data only: no per-path cache entry, so probing random paths creates nothing.
 * Hidden and trashed plugins never appear, because the summaries are read with access control (listed only).
 */
export async function getCategoryPage(path: string): Promise<CategoryPageData | null> {
  const [nodes, plugins] = await Promise.all([getCategoryNodes(), getPluginSummaries()])
  return categoryPageData(path, nodes, plugins)
}

export async function getHomeFilterOptions(): Promise<{ categories: CategoryOption[]; tags: TagOption[] }> {
  const [nodes, tags, plugins] = await Promise.all([getCategoryNodes(), getTagList(), getPluginSummaries()])
  return { categories: buildCategoryOptions(nodes, plugins), tags: buildTagOptions(tags, plugins) }
}
