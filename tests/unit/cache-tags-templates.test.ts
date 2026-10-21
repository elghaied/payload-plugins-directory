import { describe, expect, it } from 'vitest'
import { isValidCacheTag, templateCategoryTag, templateRevalidationTagsFor, templateTag, TEMPLATES_TAG } from '@/lib/cacheTags'

describe('template cache tags', () => {
  it('builds and validates the tags', () => {
    expect(TEMPLATES_TAG).toBe('templates')
    expect(templateTag('blank-tanstack')).toBe('template:blank-tanstack')
    expect(templateCategoryTag('landing-pages')).toBe('template-category:landing-pages')
    expect(isValidCacheTag('templates')).toBe(true)
    expect(isValidCacheTag(templateTag('blank-tanstack'))).toBe(true)
    expect(isValidCacheTag(templateCategoryTag('landing-pages'))).toBe(true)
    expect(isValidCacheTag('template:')).toBe(false)
    expect(isValidCacheTag('template:../x')).toBe(false)
    expect(isValidCacheTag('template-category:')).toBe(false)
  })

  it('templateRevalidationTagsFor dedupes and sorts', () => {
    expect(templateRevalidationTagsFor(['b', 'a', 'a'])).toEqual(['templates', 'template:a', 'template:b'])
    expect(templateRevalidationTagsFor([])).toEqual([])
  })
})
