import { describe, expect, it } from 'vitest'
import { NO_DESCRIPTION } from '@/lib/directory/tagline'
import {
  buildCategorySearchFields,
  buildPluginSearchFields,
  buildTagSearchFields,
  buildTemplateSearchFields,
  isPubliclyListed,
  README_INDEX_LIMIT,
  SEARCH_FIELD_LIMITS,
  type SearchFields,
} from '@/lib/search/searchDoc'
import { README_MAX_CHARS } from '@/sync/limits'

describe('isPubliclyListed', () => {
  it('is true only for listed and not trashed', () => {
    expect(isPubliclyListed({ visibility: 'listed', deletedAt: null })).toBe(true)
    expect(isPubliclyListed({ visibility: 'hidden', deletedAt: null })).toBe(false)
    expect(isPubliclyListed({ visibility: 'listed', deletedAt: '2026-10-19T00:00:00.000Z' })).toBe(false)
    expect(isPubliclyListed({})).toBe(false)
  })
})

const none = { categoryText: null, tagTitles: [] }
const textLimits: Record<string, number> = SEARCH_FIELD_LIMITS

describe('buildPluginSearchFields', () => {
  const base = { name: 'Better Auth', slug: 'better-auth', description: 'Auth for Payload', readme: '# Better Auth' }
  it('maps name, tagline, summary (+ description), taxonomy and README', () => {
    expect(
      buildPluginSearchFields(
        { ...base, ai: { tagline: 'Passkeys', summary: 'Adds passkeys.' } },
        { categoryText: 'Authentication', tagTitles: ['OAuth', 'Passkeys'] },
      ),
    ).toEqual({
      title: 'Better Auth',
      kind: 'plugin',
      slug: 'better-auth',
      tagline: 'Passkeys',
      summary: 'Adds passkeys.\nAuth for Payload',
      categoryText: 'Authentication',
      tagsText: 'OAuth Passkeys',
      readme: '# Better Auth',
      path: null,
    })
  })
  it('uses the shared tagline precedence: customTagline, ai.tagline, author description', () => {
    expect(buildPluginSearchFields({ ...base, customTagline: 'Mine', ai: { tagline: 'AI' } }, none).tagline).toBe('Mine')
    expect(buildPluginSearchFields({ ...base, ai: { tagline: 'AI' } }, none).tagline).toBe('AI')
    expect(buildPluginSearchFields(base, none).tagline).toBe('Auth for Payload')
  })
  it('never indexes the sync placeholder description', () => {
    const f = buildPluginSearchFields({ ...base, description: NO_DESCRIPTION, ai: { summary: 'Real summary' } }, none)
    expect(f.tagline).toBeNull()
    expect(f.summary).toBe('Real summary')
    const bare = buildPluginSearchFields({ ...base, description: NO_DESCRIPTION }, none)
    expect(bare.tagline).toBeNull()
    expect(bare.summary).toBeNull()
    expect(JSON.stringify(bare)).not.toContain(NO_DESCRIPTION)
  })
  it('caps README text at README_INDEX_LIMIT characters', () => {
    const f = buildPluginSearchFields({ ...base, readme: 'x'.repeat(README_INDEX_LIMIT + 10) }, none)
    expect(f.readme).toHaveLength(README_INDEX_LIMIT)
    expect(f.tagsText).toBeNull()
  })
  it('clamps a 100,000-character README (the sync maximum) and every other text field to its maxLength', () => {
    const f = buildPluginSearchFields(
      { name: 'n'.repeat(1_000), slug: 's', description: 'd'.repeat(2_000), readme: 'r'.repeat(README_MAX_CHARS), customTagline: 't'.repeat(5_000), ai: { summary: 'u'.repeat(20_000) } },
      { categoryText: 'c'.repeat(5_000), tagTitles: Array.from({ length: 800 }, () => 'tagtitle') },
    )
    expect(f.readme).toHaveLength(README_INDEX_LIMIT)
    for (const [field, max] of Object.entries(textLimits)) {
      const value = f[field as keyof SearchFields]
      if (typeof value === 'string') expect(value.length).toBeLessThanOrEqual(max)
    }
    expect(f.summary).toHaveLength(SEARCH_FIELD_LIMITS.summary)
    expect(f.tagline).toHaveLength(SEARCH_FIELD_LIMITS.tagline)
    expect(f.categoryText).toHaveLength(SEARCH_FIELD_LIMITS.categoryText)
    expect(f.tagsText).toHaveLength(SEARCH_FIELD_LIMITS.tagsText)
  })
  it('keeps every limit below Payload default text length unless it is explicit (README is the one above 40k)', () => {
    expect(README_INDEX_LIMIT).toBeLessThanOrEqual(README_MAX_CHARS)
    expect(Object.keys(textLimits).sort()).toEqual(['categoryText', 'path', 'readme', 'slug', 'summary', 'tagline', 'tagsText', 'title'])
  })
})

describe('taxonomy builders', () => {
  it('maps a category with its slug path and intro', () => {
    expect(
      buildCategorySearchFields({ title: 'OAuth', slug: 'oauth', intro: 'Sign in with providers', _h_slugPath: 'auth/oauth', _h_titlePath: 'Auth/OAuth' }),
    ).toMatchObject({ kind: 'category', title: 'OAuth', slug: 'oauth', summary: 'Sign in with providers', categoryText: 'Auth/OAuth', path: 'auth/oauth' })
  })
  it('refuses a category whose hierarchy paths were not requested (no slug fallback)', () => {
    expect(() => buildCategorySearchFields({ title: 'OAuth', slug: 'oauth' })).toThrow(/_h_slugPath/)
    expect(() => buildCategorySearchFields({ title: 'OAuth', slug: 'oauth', _h_slugPath: 'auth/oauth' })).toThrow(/_h_titlePath/)
  })
  it('maps a tag with its aliases', () => {
    expect(buildTagSearchFields({ title: 'S3', slug: 's3', aliases: ['aws-s3', 'amazon-s3'] })).toMatchObject({
      kind: 'tag',
      title: 'S3',
      slug: 's3',
      tagsText: 'aws-s3 amazon-s3',
    })
  })
})

describe('buildTemplateSearchFields', () => {
  const base = { name: 'Ecommerce', slug: 'ecommerce', description: 'A shop starter', readme: '# Ecommerce' }
  it('maps like a plugin, with kind template', () => {
    expect(
      buildTemplateSearchFields(
        { ...base, ai: { tagline: 'Sell online', summary: 'Products and carts.' } },
        { categoryText: 'E-commerce', tagTitles: ['Stripe'] },
      ),
    ).toEqual({
      title: 'Ecommerce',
      kind: 'template',
      slug: 'ecommerce',
      tagline: 'Sell online',
      summary: 'Products and carts.\nA shop starter',
      categoryText: 'E-commerce',
      tagsText: 'Stripe',
      readme: '# Ecommerce',
      path: null,
    })
  })
  it('uses the tagline precedence customTagline, ai.tagline, author description', () => {
    expect(buildTemplateSearchFields({ ...base, customTagline: 'Mine', ai: { tagline: 'AI' } }, none).tagline).toBe('Mine')
    expect(buildTemplateSearchFields({ ...base, ai: { tagline: 'AI' } }, none).tagline).toBe('AI')
    expect(buildTemplateSearchFields(base, none).tagline).toBe('A shop starter')
    expect(buildTemplateSearchFields({ ...base, description: NO_DESCRIPTION }, none).tagline).toBeNull()
  })
  it('clamps the README to 50,000 characters', () => {
    const f = buildTemplateSearchFields({ ...base, readme: 'r'.repeat(README_MAX_CHARS) }, none)
    expect(f.readme).toHaveLength(50_000)
  })
})
