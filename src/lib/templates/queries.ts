import { unstable_cache } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { LIST_TAG, TEMPLATES_TAG, templateTag } from '@/lib/cacheTags'
import { buildCategoryOptions, type CategoryOption } from '@/lib/directory/filters'
import { stampMatchesText } from '@/lib/directory/readmeStamp'
import { toCategoryNodes, type CategoryNode } from '@/taxonomy/tree'
import { compareTemplatesDefault, rankSimilarTemplates, templateCategoryPageData, type TemplateCategoryPageData } from './filters'
import { firstReadmeVideo } from './links'
import { TEMPLATE_SUMMARY_SELECT, toTemplateDetail, toTemplateSummary, videoFor } from './mappers'
import type { TemplateDetail, TemplateSummary } from './types'

async function payload() {
  return getPayload({ config: await config })
}

export const getTemplateSummaries = unstable_cache(
  async (): Promise<TemplateSummary[]> => {
    const p = await payload()
    const res = await p.find({
      collection: 'templates',
      overrideAccess: false,
      user: null,
      depth: 2, // screenshots (media) and the repository are populated
      limit: 0,
      pagination: false,
      select: TEMPLATE_SUMMARY_SELECT,
      // No `populate` (see getPluginSummaries): unrestricted population yields the real category _h_slugPath.
      context: { computeHierarchyPaths: true },
    })
    // fallbackImageUrl has admin-only field access: read it server side, only for the ids the query above proved listed.
    const ids = res.docs.map((d) => d.id)
    const fallbacks = new Map<number, string | null | undefined>()
    if (ids.length) {
      const extra = await p.find({
        collection: 'templates',
        overrideAccess: true,
        depth: 0,
        limit: 0,
        pagination: false,
        where: { id: { in: ids } },
        select: { fallbackImageUrl: true },
      })
      for (const d of extra.docs) fallbacks.set(d.id, d.fallbackImageUrl)
    }
    return res.docs
      .map((doc) => toTemplateSummary({ ...doc, fallbackImageUrl: fallbacks.get(doc.id) ?? null } as never))
      .sort(compareTemplatesDefault)
  },
  ['template-summaries'],
  { tags: [LIST_TAG, TEMPLATES_TAG], revalidate: 3600 },
)

export async function getTemplateDetail(slug: string): Promise<TemplateDetail | null> {
  // Only slugs of listed templates reach the per-slug cache (see getPluginDetail).
  const summaries = await getTemplateSummaries()
  if (!summaries.some((s) => s.slug === slug)) return null
  return unstable_cache(
    async () => {
      const p = await payload()
      const res = await p.find({
        collection: 'templates',
        overrideAccess: false,
        user: null,
        depth: 2,
        limit: 1,
        where: { slug: { equals: slug } },
        context: { computeHierarchyPaths: true },
      })
      const doc = res.docs[0]
      if (!doc) return null
      // Admin-only fields, read server side for a template the access-controlled query has shown to be listed.
      const admin = await p.findByID({
        collection: 'templates', id: doc.id, overrideAccess: true, depth: 0,
        select: { readmeHtml: true, readmeRenderVersion: true, readme: true, fallbackImageUrl: true },
      })
      const parsed = toTemplateDetail({ ...doc, fallbackImageUrl: admin.fallbackImageUrl ?? null } as never)
      // No video set: the first video the README attaches on GitHub (played the same click-to-load way).
      const readmeVideo = parsed.video ? null : firstReadmeVideo(admin.readme)
      const detail = readmeVideo ? { ...parsed, video: videoFor(readmeVideo) } : parsed
      return admin.readmeHtml && stampMatchesText(admin.readmeRenderVersion, admin.readme)
        ? { ...detail, readmeHtml: admin.readmeHtml, ...(admin.readmeRenderVersion ? { readmeRenderVersion: admin.readmeRenderVersion } : {}) }
        : detail
    },
    ['template-detail', slug],
    { tags: [LIST_TAG, TEMPLATES_TAG, templateTag(slug)], revalidate: 3600 },
  )()
}

/** Listed templates similar to `slug`, ranked from the cached summaries. [] for an unknown or unlisted slug. */
export async function getSimilarTemplates(slug: string, limit = 3): Promise<TemplateSummary[]> {
  const summaries = await getTemplateSummaries()
  const target = summaries.find((s) => s.slug === slug)
  if (!target) return []
  const bySlug = new Map(summaries.map((s) => [s.slug, s]))
  return rankSimilarTemplates(target, summaries, limit).flatMap((s) => bySlug.get(s) ?? [])
}

export const getTemplateCategoryNodes = unstable_cache(
  async (): Promise<CategoryNode[]> => {
    const res = await (await payload()).find({
      collection: 'template-categories',
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
  ['template-category-nodes'],
  { tags: [LIST_TAG, TEMPLATES_TAG], revalidate: 3600 },
)

/** Template categories with subtree counts of listed templates. */
export async function getTemplateCategoryIndex(): Promise<CategoryOption[]> {
  const [nodes, templates] = await Promise.all([getTemplateCategoryNodes(), getTemplateSummaries()])
  return buildCategoryOptions(nodes, templates)
}

/** A template category page from cached data only: no per-path cache entry; hidden and trashed templates never appear. */
export async function getTemplateCategoryPage(path: string): Promise<TemplateCategoryPageData | null> {
  const [nodes, templates] = await Promise.all([getTemplateCategoryNodes(), getTemplateSummaries()])
  return templateCategoryPageData(path, nodes, templates)
}
