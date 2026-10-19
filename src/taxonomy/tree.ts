import type { StarterCategory } from './starter'

/** A category as the site and the enrichment prompt use it. `path` is Payload's `_h_slugPath` ("parent/child"). */
export type CategoryNode = {
  id: number
  slug: string
  title: string
  intro: string | null
  icon: string | null
  parentId: number | null
  path: string
}

export type CategoryDocLike = {
  id: number
  slug: string
  title: string
  intro?: string | null
  icon?: string | null
  parent?: number | { id: number } | null
  _h_slugPath?: string | null
}

export function toCategoryNodes(docs: readonly CategoryDocLike[]): CategoryNode[] {
  return docs
    .map((d) => ({
      id: d.id,
      slug: d.slug,
      title: d.title,
      intro: d.intro ?? null,
      icon: d.icon ?? null,
      parentId: d.parent == null ? null : typeof d.parent === 'object' ? d.parent.id : d.parent,
      path: d._h_slugPath || d.slug,
    }))
    .sort((a, b) => a.path.localeCompare(b.path))
}

export function childrenOf(nodes: readonly CategoryNode[], parentId: number | null): CategoryNode[] {
  return nodes.filter((n) => n.parentId === parentId)
}

/** Categories nobody points at as parent: the only ones the AI may choose (spec §3.1). */
export function leafCategories(nodes: readonly CategoryNode[]): CategoryNode[] {
  const parents = new Set(nodes.flatMap((n) => (n.parentId === null ? [] : [n.parentId])))
  return nodes.filter((n) => !parents.has(n.id))
}

/** Root-to-node chain for a slug path; unknown segments are skipped, an unknown path gives []. */
export function trailFor(nodes: readonly CategoryNode[], path: string): CategoryNode[] {
  const byPath = new Map(nodes.map((n) => [n.path, n]))
  const segments = path.split('/')
  const trail: CategoryNode[] = []
  for (let i = 1; i <= segments.length; i++) {
    const node = byPath.get(segments.slice(0, i).join('/'))
    if (node) trail.push(node)
  }
  return trail
}

export function titlePathOf(nodes: readonly CategoryNode[], node: CategoryNode): string {
  const trail = trailFor(nodes, node.path)
  return trail.length ? trail.map((n) => n.title).join(' / ') : node.title
}

export function isInSubtree(categoryPath: string | null | undefined, path: string): boolean {
  return Boolean(categoryPath) && (categoryPath === path || categoryPath!.startsWith(`${path}/`))
}

/** Number of plugins in each category's subtree, keyed by path. Paths of unknown categories are ignored. */
export function subtreeCounts(nodes: readonly CategoryNode[], categoryPaths: readonly (string | null | undefined)[]): Map<string, number> {
  const counts = new Map(nodes.map((n) => [n.path, 0]))
  for (const p of categoryPaths) {
    if (!p) continue
    const segments = p.split('/')
    for (let i = 1; i <= segments.length; i++) {
      const key = segments.slice(0, i).join('/')
      const current = counts.get(key)
      if (current !== undefined) counts.set(key, current + 1)
    }
  }
  return counts
}

export type FlatStarterCategory = { slug: string; title: string; intro: string; icon: string; parentSlug: string | null }

/** Pre-order: every parent comes before its children, so seeding can resolve parent ids in one pass. */
export function flattenStarter(cats: readonly StarterCategory[], parentSlug: string | null = null): FlatStarterCategory[] {
  return cats.flatMap((c) => [
    { slug: c.slug, title: c.title, intro: c.intro, icon: c.icon, parentSlug },
    ...flattenStarter(c.children ?? [], c.slug),
  ])
}
