import type { Payload } from 'payload'
import type { Plugin } from '@/payload-types'
import { relationId } from '@/lib/relationId'
import { toMcpCategory, type McpCategory } from './format'

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
