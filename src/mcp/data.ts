import type { Payload, Where } from 'payload'
import type { Plugin, Template } from '@/payload-types'
import { SearchTimeoutError, searchIndex } from '@/lib/search/fts'
import { normalizeQuery } from '@/lib/search/query'
import { SEARCH_LIMITS } from '@/lib/search/searchDirectory'
import { isInSubtree } from '@/taxonomy/tree'
import { relationId } from '@/lib/relationId'
import { toMcpCategory, toMcpTemplateCategory, type McpCategory, type McpTemplateCategory } from './format'

// Field-level select: maintainers, locks, contentHash, visibility, ai.model etc. are never even loaded.
export const MCP_PLUGIN_SELECT = {
  slug: true,
  name: true,
  packageName: true,
  description: true,
  readme: true,
  payloadVersionRange: true,
  payloadMajors: true,
  npm: true,
  healthScore: true,
  isOfficial: true,
  repository: true,
  category: true,
  _h_tags: true,
  customTagline: true,
  ai: { tagline: true, summary: true, features: true, useCases: true, confidence: true },
} as const

// Anonymous, access-controlled reads only. Never pass the MCP `req`.
const anon = { overrideAccess: false, user: null } as const
// `_h_slugPath` is virtual and exists only when requested. A fresh context object per read.
const pathsContext = () => ({ computeHierarchyPaths: true })

/** Listed plugins among `slugs` (at most a handful: callers validate the count). Hidden and trashed ones never come back. */
export async function findListedPlugins(payload: Payload, slugs: string[]): Promise<Plugin[]> {
  if (!slugs.length) return []
  const res = await payload.find({
    collection: 'plugins',
    ...anon,
    depth: 1,
    pagination: false,
    limit: slugs.length,
    select: MCP_PLUGIN_SELECT,
    context: pathsContext(),
    where: { slug: { in: slugs } },
  })
  return res.docs as unknown as Plugin[]
}

/**
 * The category tree with the number of listed plugins directly in each category. The (small) category table is read per
 * call; the plugin counts come from the cached listed-plugin summaries (LIST_TAG), so this never scans plugins itself.
 * A category that lacks `_h_slugPath` is logged and skipped rather than failing the whole tool.
 */
export async function listCategoriesWithCounts(payload: Payload): Promise<McpCategory[]> {
  // Lazy: queries.ts imports @payload-config, which imports this module through the MCP plugin (a static import is a cycle).
  const { getPluginSummaries } = await import('@/lib/directory/queries')
  const [cats, summaries] = await Promise.all([
    payload.find({
      collection: 'categories',
      ...anon,
      depth: 0,
      pagination: false,
      limit: 0,
      select: { title: true, slug: true, intro: true, parent: true, _h_slugPath: true },
      context: pathsContext(),
    }),
    getPluginSummaries(),
  ])
  const counts = new Map<string, number>()
  for (const s of summaries) if (s.categoryPath) counts.set(s.categoryPath, (counts.get(s.categoryPath) ?? 0) + 1)
  const slugById = new Map(cats.docs.map((c) => [c.id, c.slug]))
  const out: McpCategory[] = []
  for (const c of cats.docs) {
    try {
      out.push(toMcpCategory(c, slugById.get(relationId(c.parent) ?? -1) ?? null, counts.get(c._h_slugPath ?? '') ?? 0))
    } catch (err) {
      payload.logger.error({ err, msg: `mcp: skipping category "${c.slug}" in listCategories` })
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

// Field-level select for templates: maintainers, locks, visibility, contentHash, ai.promptHash, screenshots etc. are never loaded.
// readmeHtml / fallbackImageUrl are admin-only fields and are not selected, so no access-controlled read can return them.
export const MCP_TEMPLATE_SELECT = {
  slug: true,
  name: true,
  description: true,
  readme: true,
  isOfficial: true,
  isTemplateRepo: true,
  path: true,
  license: true,
  payloadVersionRange: true,
  payloadMajors: true,
  stackDetected: true,
  stackOverride: true,
  repository: true,
  category: true,
  _h_tags: true,
  demoUrl: true,
  videoUrl: true,
  customTagline: true,
  ai: { tagline: true, summary: true, features: true, useCases: true },
} as const

/** One listed template by slug (anonymous, access-controlled). Hidden, trashed and unknown slugs give null. */
export async function findListedTemplate(payload: Payload, slug: string): Promise<Template | null> {
  const res = await payload.find({
    collection: 'templates',
    ...anon,
    depth: 1,
    limit: 1,
    pagination: false,
    select: MCP_TEMPLATE_SELECT,
    context: pathsContext(),
    where: { slug: { equals: slug } },
  })
  return (res.docs[0] as unknown as Template | undefined) ?? null
}

export type TemplateSearchResult = { status: 'ok' | 'timeout'; query: string; templates: Template[]; unknownCategory?: true }

/**
 * Listed templates matching `raw` and the filters. The shared `searchDirectory` only returns templates when no plugin filter
 * is active, so filters are applied here, to the access-controlled candidates: `category` is a template-category slug
 * (its subtree), `payloadMajor` is matched against `payloadMajors`. A stale index row for a hidden or trashed template is
 * dropped by the anonymous read. The caller holds the search budget.
 */
export async function searchListedTemplates(
  payload: Payload,
  raw: unknown,
  opts: { limit: number; payloadMajor?: '1' | '2' | '3' | '4'; categorySlug?: string },
): Promise<TemplateSearchResult> {
  const normalized = normalizeQuery(raw)
  const hasFilter = Boolean(opts.payloadMajor || opts.categorySlug)
  const tooShort = normalized !== null && Array.from(normalized.text).length < SEARCH_LIMITS.minQueryChars
  const query = tooShort ? null : normalized
  const text = query?.text ?? ''
  if (!query && !hasFilter) return { status: 'ok', query: text, templates: [] }

  const and: Where[] = []
  if (opts.payloadMajor) and.push({ payloadMajors: { in: [opts.payloadMajor] } })
  if (opts.categorySlug) {
    const cats = await payload.find({ collection: 'template-categories', ...anon, depth: 0, pagination: false, limit: 0, select: { slug: true, _h_slugPath: true }, context: pathsContext() })
    const root = cats.docs.find((c) => c.slug === opts.categorySlug)
    if (!root) return { status: 'ok', query: text, templates: [], unknownCategory: true }
    if (!root._h_slugPath) throw new Error(`Template category "${root.slug}" was loaded without _h_slugPath`)
    const rootPath = root._h_slugPath
    and.push({ category: { in: cats.docs.filter((c) => isInSubtree(c._h_slugPath, rootPath)).map((c) => c.id) } })
  }

  const read = (where: Where, limit: number, sort?: string) =>
    payload.find({
      collection: 'templates',
      ...anon,
      depth: 1,
      limit,
      pagination: false,
      select: MCP_TEMPLATE_SELECT,
      context: pathsContext(),
      ...(sort ? { sort } : {}),
      where,
    })

  if (!query) {
    // Filter-only listing: official first is not a goal here; most recently updated first.
    return { status: 'ok', query: '', templates: (await read({ and }, opts.limit, '-lastUpdatedAt')).docs as unknown as Template[] }
  }
  try {
    const pool = hasFilter ? SEARCH_LIMITS.maxPool : opts.limit + 25
    const hits = await searchIndex(payload, query, { perKind: pool })
    const candidates = hits.filter((h) => h.kind === 'template').map((h) => h.slug).slice(0, pool)
    if (!candidates.length) return { status: 'ok', query: text, templates: [] }
    const docs = (await read({ and: [{ slug: { in: candidates } }, ...and] }, 0)).docs as unknown as Template[]
    const order = new Map(candidates.map((slug, i) => [slug, i]))
    docs.sort((a, b) => (order.get(a.slug) ?? Infinity) - (order.get(b.slug) ?? Infinity))
    return { status: 'ok', query: text, templates: docs.slice(0, opts.limit) }
  } catch (err) {
    if (err instanceof SearchTimeoutError) return { status: 'timeout', query: text, templates: [] }
    throw err
  }
}

/** The template-category tree with the number of listed templates directly in each category (cached summaries, like plugins). */
export async function listTemplateCategoriesWithCounts(payload: Payload): Promise<McpTemplateCategory[]> {
  const { getTemplateSummaries } = await import('@/lib/templates/queries')
  const [cats, summaries] = await Promise.all([
    payload.find({
      collection: 'template-categories',
      ...anon,
      depth: 0,
      pagination: false,
      limit: 0,
      select: { title: true, slug: true, intro: true, parent: true, _h_slugPath: true },
      context: pathsContext(),
    }),
    getTemplateSummaries(),
  ])
  const counts = new Map<string, number>()
  for (const s of summaries) if (s.categoryPath) counts.set(s.categoryPath, (counts.get(s.categoryPath) ?? 0) + 1)
  const slugById = new Map(cats.docs.map((c) => [c.id, c.slug]))
  const out: McpTemplateCategory[] = []
  for (const c of cats.docs) {
    try {
      out.push(toMcpTemplateCategory(c, slugById.get(relationId(c.parent) ?? -1) ?? null, counts.get(c._h_slugPath ?? '') ?? 0))
    } catch (err) {
      payload.logger.error({ err, msg: `mcp: skipping template category "${c.slug}" in listCategories` })
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}
