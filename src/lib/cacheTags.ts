/**
 * Cache tag vocabulary (spec §4.1). Every cached query carries LIST_TAG, so revalidating it is a full revalidation.
 * Today: summaries/meta carry `plugins`; detail pages carry `plugins` + `plugin:<slug>`. `home`, `stats`, `trending`
 * and `category:<slug>` are accepted now and attached by the phases that add those cached queries.
 */
export const LIST_TAG = 'plugins'
export const pluginTag = (slug: string): string => `plugin:${slug}`
export const categoryTag = (slug: string): string => `category:${slug}`
/** Tags of the pages that read the daily snapshots (Phase 3 trending and stats); revalidated after each snapshot. */
export const SNAPSHOT_TAGS = ['trending', 'stats'] as const

export const CACHE_TAG_PATTERN = /^(?:plugins|home|stats|trending|(?:plugin|category):[A-Za-z0-9][A-Za-z0-9._-]{0,200})$/

export function isValidCacheTag(tag: unknown): tag is string {
  return typeof tag === 'string' && CACHE_TAG_PATTERN.test(tag)
}

/** Tags to revalidate after the given plugins changed: the list tag plus one tag per plugin; [] when none changed. */
export function revalidationTagsFor(slugs: Iterable<string>): string[] {
  const unique = [...new Set(slugs)].sort()
  return unique.length ? [LIST_TAG, ...unique.map(pluginTag)] : []
}
