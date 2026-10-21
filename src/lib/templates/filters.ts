import { childrenOf, isInSubtree, subtreeCounts, trailFor, type CategoryNode } from '@/taxonomy/tree'
import { matchesCategory, type CategoryOption } from '@/lib/directory/filters'
import { STACKS, type StackValue } from './stack'
import type { TemplateSummary } from './types'
import type { PayloadMajor } from '@/lib/versions'

export const TEMPLATE_SORTS = ['default', 'stars', 'recent', 'name'] as const
export type TemplateSort = (typeof TEMPLATE_SORTS)[number]
export type TemplateSource = 'official' | 'community'

export type TemplateFilters = {
  q?: string
  category?: string
  stack?: StackValue
  major?: PayloadMajor
  source?: TemplateSource
}

const MAJORS: readonly PayloadMajor[] = ['1', '2', '3', '4', 'unknown']
const SOURCES: readonly TemplateSource[] = ['official', 'community']
/** Values that never mean a real selection in a URL (see updateParams). */
const RESERVED = new Set(['', 'all', 'featured'])
const CATEGORY_PARAM = /^[a-z0-9][a-z0-9-]{0,80}$/
const Q_MAX = 100

const byName = (a: TemplateSummary, b: TemplateSummary) => a.name.localeCompare(b.name) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)

/** Official first, then stars descending, then name. */
export function compareTemplatesDefault(a: TemplateSummary, b: TemplateSummary): number {
  return Number(b.isOfficial) - Number(a.isOfficial) || (b.stars ?? 0) - (a.stars ?? 0) || byName(a, b)
}

export function sortTemplates(list: readonly TemplateSummary[], sort: TemplateSort): TemplateSummary[] {
  const copy = [...list]
  if (sort === 'stars') return copy.sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1) || byName(a, b))
  if (sort === 'recent') return copy.sort((a, b) => b.lastUpdate.localeCompare(a.lastUpdate) || byName(a, b))
  if (sort === 'name') return copy.sort(byName)
  return copy.sort(compareTemplatesDefault)
}

export function filterTemplates(list: readonly TemplateSummary[], f: TemplateFilters, categoryOptions: readonly CategoryOption[]): TemplateSummary[] {
  const q = f.q?.trim().toLowerCase()
  return list.filter((t) => {
    if (f.stack && t.stack !== f.stack) return false
    if (f.major && !t.payloadMajors.includes(f.major)) return false
    if (f.source && (f.source === 'official') !== t.isOfficial) return false
    if (f.category && !matchesCategory(t, f.category, categoryOptions)) return false
    if (q && !(t.name.toLowerCase().includes(q) || t.tagline.toLowerCase().includes(q) || (t.tags ?? []).some((x) => x.toLowerCase().includes(q)))) return false
    return true
  })
}

export type TemplateParams = TemplateFilters & { sort?: Exclude<TemplateSort, 'default'> }

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>

function pick(source: ParamSource, key: string): string | undefined {
  const raw = source instanceof URLSearchParams ? source.get(key) : source[key]
  const value = Array.isArray(raw) ? raw[0] : raw
  return typeof value === 'string' && !RESERVED.has(value) ? value : undefined
}

/** URL params -> known values only. Anything unknown (or reserved like "all") is left out, never defaulted to "all". */
export function resolveTemplateParams(source: ParamSource): TemplateParams {
  const out: TemplateParams = {}
  const q = pick(source, 'q')?.trim().slice(0, Q_MAX)
  if (q) out.q = q
  const category = pick(source, 'category')
  if (category && CATEGORY_PARAM.test(category)) out.category = category
  const stack = pick(source, 'stack')
  if (stack && (STACKS as readonly string[]).includes(stack)) out.stack = stack as StackValue
  const major = pick(source, 'major')
  if (major && (MAJORS as readonly string[]).includes(major)) out.major = major as PayloadMajor
  const src = pick(source, 'source')
  if (src && (SOURCES as readonly string[]).includes(src)) out.source = src as TemplateSource
  const sort = pick(source, 'sort')
  if (sort && sort !== 'default' && (TEMPLATE_SORTS as readonly string[]).includes(sort)) out.sort = sort as TemplateParams['sort']
  return out
}

export type TemplateCategoryPageData = {
  node: CategoryNode
  trail: CategoryNode[]
  children: (CategoryNode & { count: number })[]
  templates: TemplateSummary[]
}

/** Everything a /templates/categories/<path> page shows. `templates` must already be the listed-only summaries. */
export function templateCategoryPageData(path: string, nodes: readonly CategoryNode[], templates: readonly TemplateSummary[]): TemplateCategoryPageData | null {
  const node = nodes.find((n) => n.path === path)
  if (!node) return null
  const counts = subtreeCounts(nodes, templates.map((t) => t.categoryPath))
  return {
    node,
    trail: trailFor(nodes, path),
    children: childrenOf(nodes, node.id).map((c) => ({ ...c, count: counts.get(c.path) ?? 0 })),
    templates: templates.filter((t) => isInSubtree(t.categoryPath, path)).sort(compareTemplatesDefault),
  }
}

/** Slugs of the templates most similar to `target`: same category first, then shared tags, then stars (deterministic). */
export function rankSimilarTemplates(target: TemplateSummary, all: readonly TemplateSummary[], limit = 3): string[] {
  const tags = new Set(target.tags ?? [])
  return all
    .filter((t) => t.slug !== target.slug)
    .map((t) => ({
      t,
      sameCategory: Boolean(target.categoryPath) && t.categoryPath === target.categoryPath,
      shared: (t.tags ?? []).filter((x) => tags.has(x)).length,
    }))
    .filter((x) => x.sameCategory || x.shared > 0)
    .sort((a, b) => Number(b.sameCategory) - Number(a.sameCategory) || b.shared - a.shared || (b.t.stars ?? 0) - (a.t.stars ?? 0) || byName(a.t, b.t))
    .slice(0, limit)
    .map((x) => x.t.slug)
}
