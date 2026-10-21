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

export async function listCategoriesWithCounts(payload: Payload): Promise<McpCategory[]> {
  const cats = await payload.find({
    collection: 'categories',
    ...anon,
    depth: 0,
    pagination: false,
    limit: 0,
    select: { title: true, slug: true, intro: true, parent: true, _h_slugPath: true },
    context: pathsContext(),
  })
  const plugins = await payload.find({ collection: 'plugins', ...anon, depth: 0, pagination: false, limit: 0, select: { category: true } })
  const counts = new Map<number, number>()
  for (const p of plugins.docs) {
    const id = relationId(p.category)
    if (id !== undefined) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  const slugById = new Map(cats.docs.map((c) => [c.id, c.slug]))
  return cats.docs
    .map((c) => toMcpCategory(c, slugById.get(relationId(c.parent) ?? -1) ?? null, counts.get(c.id) ?? 0))
    .sort((a, b) => a.path.localeCompare(b.path))
}
