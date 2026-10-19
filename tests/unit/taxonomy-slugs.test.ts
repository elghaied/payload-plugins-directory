import { describe, expect, it } from 'vitest'
import { RESERVED_TAXONOMY_SLUGS, validateTaxonomySlug } from '@/taxonomy/slugs'

describe('validateTaxonomySlug', () => {
  it('accepts lower-case kebab slugs', () => {
    for (const s of ['seo', 'cloud-storage', 'i18n', 'ai-search']) expect(validateTaxonomySlug(s)).toBe(true)
  })
  it('rejects malformed slugs', () => {
    for (const s of ['', 'SEO', 'cloud_storage', '-x', 'x-', 'a--b', 'a/b', 'a b', 42, null, 'x'.repeat(61)]) {
      expect(validateTaxonomySlug(s)).not.toBe(true)
    }
  })
  it('rejects the values the home filters reserve (updateParams strips "all" and "featured")', () => {
    expect([...RESERVED_TAXONOMY_SLUGS].sort()).toEqual(['all', 'featured', 'uncategorized'])
    for (const s of RESERVED_TAXONOMY_SLUGS) expect(validateTaxonomySlug(s)).toMatch(/reserved/)
  })
})
