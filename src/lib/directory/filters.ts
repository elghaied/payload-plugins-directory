import { childrenOf, isInSubtree, subtreeCounts, trailFor, type CategoryNode } from '@/taxonomy/tree'
import type { PluginSummary } from './types'

/** URL value for plugins without a category (spec §3.1: "Uncategorized" is not a category). Reserved as a slug. */
export const UNCATEGORIZED = 'uncategorized'

export type CategoryOption = { slug: string; title: string; path: string; depth: number; count: number }
export type TagOption = { slug: string; title: string; count: number }
type Categorized = Pick<PluginSummary, 'categoryPath'>
type Tagged = Pick<PluginSummary, 'tags'>

export function buildCategoryOptions(nodes: readonly CategoryNode[], plugins: readonly Categorized[]): CategoryOption[] {
  const counts = subtreeCounts(nodes, plugins.map((p) => p.categoryPath))
  return nodes.map((n) => ({ slug: n.slug, title: n.title, path: n.path, depth: n.path.split('/').length - 1, count: counts.get(n.path) ?? 0 }))
}

export function buildTagOptions(tags: readonly { slug: string; title: string }[], plugins: readonly Tagged[]): TagOption[] {
  const counts = new Map<string, number>()
  for (const p of plugins) for (const t of p.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1)
  return tags
    .flatMap((t) => (counts.get(t.slug) ? [{ slug: t.slug, title: t.title, count: counts.get(t.slug)! }] : []))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title))
}

/** `selected` is a category slug, UNCATEGORIZED or 'all'. Unknown slugs match nothing (the UI resets them to 'all'). */
export function matchesCategory(plugin: Categorized, selected: string, options: readonly CategoryOption[]): boolean {
  if (selected === 'all') return true
  if (selected === UNCATEGORIZED) return !plugin.categoryPath
  const option = options.find((o) => o.slug === selected)
  return option ? isInSubtree(plugin.categoryPath, option.path) : false
}

export const matchesTag = (plugin: Tagged, selected: string): boolean => selected === 'all' || (plugin.tags ?? []).includes(selected)

/** Spec §7: plugins on a category page are ranked by health, then downloads. */
export function rankForCategory(a: PluginSummary, b: PluginSummary): number {
  return (b.healthScore ?? 0) - (a.healthScore ?? 0) || (b.weeklyDownloads ?? 0) - (a.weeklyDownloads ?? 0) || a.name.localeCompare(b.name)
}

export type CategoryPageData = {
  node: CategoryNode
  trail: CategoryNode[]
  children: (CategoryNode & { count: number })[]
  plugins: PluginSummary[]
}

/** Everything a /categories/<path> page shows, from cached data. `plugins` must already be the listed-only summaries. */
export function categoryPageData(path: string, nodes: readonly CategoryNode[], plugins: readonly PluginSummary[]): CategoryPageData | null {
  const node = nodes.find((n) => n.path === path)
  if (!node) return null
  const counts = subtreeCounts(nodes, plugins.map((p) => p.categoryPath))
  return {
    node,
    trail: trailFor(nodes, path),
    children: childrenOf(nodes, node.id).map((c) => ({ ...c, count: counts.get(c.path) ?? 0 })),
    plugins: plugins.filter((p) => isInSubtree(p.categoryPath, path)).sort(rankForCategory),
  }
}
