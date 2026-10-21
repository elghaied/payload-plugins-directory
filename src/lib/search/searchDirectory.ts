import type { Payload, Where } from 'payload'
import type { Category, Plugin, Tag } from '@/payload-types'
import { SUMMARY_SELECT } from '@/lib/directory/mappers'
import { isInSubtree } from '@/taxonomy/tree'
import { SearchBusyError, withSearchBudget } from './budget'
import { SearchTimeoutError, searchIndex } from './fts'
import { normalizeQuery, type NormalizedQuery } from './query'

export const PLUGIN_SEARCH_SELECT = {
  ...SUMMARY_SELECT,
  customTagline: true,
  ai: { tagline: true, summary: true },
  category: true,
  _h_tags: true,
} as const

/** `_h_slugPath` / `_h_titlePath` are virtual: they exist only when a read names them. */
const CATEGORY_SELECT = { title: true, slug: true, intro: true, parent: true, _h_slugPath: true, _h_titlePath: true } as const

export type PluginFilter = { payloadMajor?: '1' | '2' | '3' | '4'; categorySlug?: string }
export type DirectorySearch = {
  /** 'ok', or why no results could be produced: the callers render a retry message instead of catching. */
  status: 'ok' | 'timeout' | 'busy'
  query: NormalizedQuery | null
  plugins: Plugin[]
  categories: Category[]
  tags: Tag[]
  unknownCategory?: true
  page: number
  /** True when more visible matches exist after this page, within the top-`maxPool` ranked candidates. */
  hasMore: boolean
}

/** Bounds shared with the MCP endpoint (Task 9). */
export const SEARCH_LIMITS = {
  minQueryChars: 2,
  maxPluginLimit: 100,
  maxTaxonomyLimit: 50,
  maxPage: 10,
  /** Ranked candidate slugs considered per query; documents are only loaded for the final page. */
  maxPool: 500,
} as const

// Every read below is anonymous and access-controlled: hidden/trashed plugins cannot come back,
// whatever the index contains.
const anon = { overrideAccess: false, user: null } as const
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(Number.isFinite(n) ? n : min)))
// A fresh context object per read (a shared one would accumulate hook state across calls).
const displayContext = () => ({ computeHierarchyPaths: true })

const empty = (query: NormalizedQuery | null, page: number): DirectorySearch => ({ status: 'ok', query, plugins: [], categories: [], tags: [], page, hasMore: false })

async function filterWhere(payload: Payload, filter?: PluginFilter): Promise<Where | null | 'unknown-category'> {
  const and: Where[] = []
  if (filter?.payloadMajor) and.push({ payloadMajors: { in: [filter.payloadMajor] } })
  if (filter?.categorySlug) {
    const cats = await payload.find({ collection: 'categories', ...anon, depth: 0, pagination: false, limit: 0, select: { slug: true, _h_slugPath: true } })
    const root = cats.docs.find((c) => c.slug === filter.categorySlug)
    if (!root) return 'unknown-category'
    if (!root._h_slugPath) throw new Error(`Category "${root.slug}" was loaded without _h_slugPath`)
    const rootPath = root._h_slugPath
    // Subtree match on the slug path: the category itself and everything below it.
    const ids = cats.docs.filter((c) => isInSubtree(c._h_slugPath, rootPath)).map((c) => c.id)
    and.push({ category: { in: ids } })
  }
  return and.length ? { and } : null
}

function inRankOrder<T extends { slug: string }>(docs: T[], slugs: string[]): T[] {
  const order = new Map(slugs.map((s, i) => [s, i]))
  return [...docs].sort((a, b) => (order.get(a.slug) ?? Infinity) - (order.get(b.slug) ?? Infinity))
}

export async function searchDirectory(
  payload: Payload,
  raw: unknown,
  opts: { pluginLimit?: number; taxonomyLimit?: number; page?: number; filter?: PluginFilter } = {},
): Promise<DirectorySearch> {
  const pluginLimit = clamp(opts.pluginLimit ?? 50, 1, SEARCH_LIMITS.maxPluginLimit)
  const taxonomyLimit = clamp(opts.taxonomyLimit ?? 10, 0, SEARCH_LIMITS.maxTaxonomyLimit)
  // page x limit never exceeds the candidate pool, so a page is never silently short because the pool ran out.
  const page = clamp(opts.page ?? 1, 1, Math.min(SEARCH_LIMITS.maxPage, Math.floor(SEARCH_LIMITS.maxPool / pluginLimit)))
  const normalized = normalizeQuery(raw)
  const hasFilter = Boolean(opts.filter?.payloadMajor || opts.filter?.categorySlug)
  const tooShort = normalized !== null && Array.from(normalized.text).length < SEARCH_LIMITS.minQueryChars

  // No database work for blank or too-short queries without a filter. With a filter, a too-short query behaves as no query.
  if (!hasFilter && (normalized === null || tooShort)) return empty(tooShort ? normalized : null, page)
  const query = tooShort ? null : normalized

  const run = async (): Promise<DirectorySearch> => {
    const where = await filterWhere(payload, opts.filter)
    if (where === 'unknown-category') return { ...empty(query, page), unknownCategory: true as const }

    if (!query) {
      // Filter-only listing: one filtered, paged, access-controlled read of the final page.
      const res = await payload.find({
        collection: 'plugins',
        ...anon,
        depth: 1,
        limit: pluginLimit,
        page,
        select: PLUGIN_SEARCH_SELECT,
        sort: '-healthScore',
        context: displayContext(),
        ...(where ? { where } : {}),
      })
      return { ...empty(null, page), plugins: res.docs as unknown as Plugin[], hasMore: res.hasNextPage }
    }

    const offset = (page - 1) * pluginLimit
    const pool = hasFilter ? SEARCH_LIMITS.maxPool : Math.min(SEARCH_LIMITS.maxPool, offset + pluginLimit + 25)
    const hits = await searchIndex(payload, query, { perKind: Math.max(pool, taxonomyLimit, 1) })
    const slugsOf = (kind: string, n: number) => hits.filter((h) => h.kind === kind).map((h) => h.slug).slice(0, n)
    // The index has no package name: an exact package-name match (e.g. "@acme/payload-seo") is ranked first.
    const byPackage = await payload.find({
      collection: 'plugins',
      ...anon,
      depth: 0,
      pagination: false,
      limit: 5,
      select: { slug: true },
      where: { packageName: { in: [...new Set([query.text, query.text.toLowerCase()])] } },
    })
    const candidates = [...new Set([...byPackage.docs.map((d) => d.slug), ...slugsOf('plugin', pool)])].slice(0, pool)
    const categorySlugs = slugsOf('category', taxonomyLimit)
    const tagSlugs = slugsOf('tag', taxonomyLimit)

    // Phase 1: slug-only, depth-0, access-controlled (and filtered) read over the ranked candidates. A stale index
    // row for a hidden or trashed plugin is dropped here.
    let visible: string[] = []
    if (candidates.length) {
      const res = await payload.find({
        collection: 'plugins',
        ...anon,
        depth: 0,
        pagination: false,
        limit: 0,
        select: { slug: true },
        where: { and: [{ slug: { in: candidates } }, ...(where ? [where] : [])] },
      })
      const ok = new Set(res.docs.map((d) => d.slug))
      visible = candidates.filter((s) => ok.has(s))
    }
    const pageSlugs = visible.slice(offset, offset + pluginLimit)

    // Phase 2: full documents only for the final page.
    const plugins = pageSlugs.length
      ? (
          await payload.find({
            collection: 'plugins',
            ...anon,
            depth: 1,
            pagination: false,
            limit: 0,
            select: PLUGIN_SEARCH_SELECT,
            context: displayContext(),
            where: { slug: { in: pageSlugs } },
          })
        ).docs
      : []
    const categories = categorySlugs.length
      ? (await payload.find({ collection: 'categories', ...anon, depth: 0, pagination: false, limit: 0, select: CATEGORY_SELECT, where: { slug: { in: categorySlugs } } })).docs
      : []
    const tags = tagSlugs.length
      ? (await payload.find({ collection: 'tags', ...anon, depth: 0, pagination: false, limit: 0, select: { title: true, slug: true, aliases: true }, where: { slug: { in: tagSlugs } } })).docs
      : []

    return {
      query,
      plugins: inRankOrder(plugins as unknown as Plugin[], pageSlugs),
      categories: inRankOrder(categories as unknown as Category[], categorySlugs),
      tags: inRankOrder(tags as unknown as Tag[], tagSlugs),
      page,
      hasMore: visible.length > offset + pluginLimit,
      status: 'ok' as const,
    }
  }

  try {
    return await withSearchBudget(run)
  } catch (err) {
    if (err instanceof SearchTimeoutError) return { ...empty(query, page), status: 'timeout' }
    if (err instanceof SearchBusyError) return { ...empty(query, page), status: 'busy' }
    throw err
  }
}
