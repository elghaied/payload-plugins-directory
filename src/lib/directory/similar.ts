import type { PluginSummary } from './types'

/** The fields similarity reads; PluginSummary satisfies it. */
export type SimilarityEntry = Pick<PluginSummary, 'slug' | 'categoryPath' | 'tags' | 'healthScore' | 'weeklyDownloads'>

/** Slug (and path) of the catch-all category: sharing it says nothing about similarity. */
const OTHER_CATEGORY_PATH = 'other'

const categoryOf = (e: SimilarityEntry) => (e.categoryPath && e.categoryPath !== OTHER_CATEGORY_PATH ? e.categoryPath : null)

/**
 * Slugs of the plugins most similar to `target`: same category +2, each shared tag +1, score 0 excluded.
 * Ties break by health, then weekly downloads, then slug, so the order is deterministic.
 */
export function rankSimilar(target: SimilarityEntry, all: SimilarityEntry[], limit = 6): string[] {
  const tags = new Set(target.tags ?? [])
  const category = categoryOf(target)
  return all
    .filter((e) => e.slug !== target.slug)
    .map((e) => ({
      e,
      score: (category !== null && categoryOf(e) === category ? 2 : 0) + (e.tags ?? []).filter((t) => tags.has(t)).length,
    }))
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.e.healthScore ?? 0) - (a.e.healthScore ?? 0) ||
        (b.e.weeklyDownloads ?? 0) - (a.e.weeklyDownloads ?? 0) ||
        (a.e.slug < b.e.slug ? -1 : a.e.slug > b.e.slug ? 1 : 0),
    )
    .slice(0, limit)
    .map((x) => x.e.slug)
}
