/**
 * Values the home-page filters use themselves: `updateParams` in PluginDirectory strips "all" and "featured",
 * and "uncategorized" selects plugins without a category. A category or tag with one of these slugs could
 * never be selected, so they are rejected.
 */
export const RESERVED_TAXONOMY_SLUGS = new Set(['all', 'featured', 'uncategorized'])

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validateTaxonomySlug(value: unknown): true | string {
  if (typeof value !== 'string' || !SLUG.test(value)) {
    return 'Use lower-case letters, digits and single hyphens, e.g. "cloud-storage".'
  }
  if (value.length > 60) return 'Use at most 60 characters.'
  if (RESERVED_TAXONOMY_SLUGS.has(value)) return `"${value}" is reserved by the directory filters.`
  return true
}
