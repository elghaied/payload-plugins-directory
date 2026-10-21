import { describe, expect, it } from 'vitest'
import type { ExtractedPlugin } from '@/sync/extract'
import { clampExtracted, clampExtractedTemplate, DESCRIPTION_MAX_CHARS, KEYWORDS_MAX, LICENSE_MAX_CHARS, README_MAX_CHARS, truncateReadme } from '@/sync/limits'
import type { ExtractedTemplate } from '@/sync/templates/extract'

describe('truncateReadme', () => {
  it('leaves a README under the limit untouched', () => {
    expect(truncateReadme('# Hi\n\ntext')).toBe('# Hi\n\ntext')
    const exact = 'a'.repeat(README_MAX_CHARS)
    expect(truncateReadme(exact)).toBe(exact)
  })

  it('cuts at the last newline when one is within the final 2,000 characters', () => {
    const text = `${'a'.repeat(README_MAX_CHARS - 500)}\nline two\n${'b'.repeat(2000)}`
    const out = truncateReadme(text)
    expect(out.length).toBeLessThanOrEqual(README_MAX_CHARS)
    expect(out.endsWith('line two')).toBe(true)
  })

  it('cuts hard when the last newline is further than 2,000 characters from the limit', () => {
    const text = `${'a'.repeat(100)}\n${'b'.repeat(README_MAX_CHARS + 500)}`
    const out = truncateReadme(text)
    expect(out).toHaveLength(README_MAX_CHARS)
    expect(out).toBe(text.slice(0, README_MAX_CHARS))
  })

  it('cuts hard when there is no newline', () => {
    expect(truncateReadme('x'.repeat(README_MAX_CHARS + 10))).toHaveLength(README_MAX_CHARS)
  })

  it('never splits a surrogate pair at the boundary', () => {
    const text = `${'a'.repeat(README_MAX_CHARS - 1)}😀tail`
    const out = truncateReadme(text)
    expect(out).toBe('a'.repeat(README_MAX_CHARS - 1))
    expect(out.charCodeAt(out.length - 1)).toBe(97)
  })

  it('keeps a pair that ends exactly at the limit', () => {
    const out = truncateReadme(`${'a'.repeat(README_MAX_CHARS - 2)}😀tail`)
    expect(out.endsWith('😀')).toBe(true)
    expect(out).toHaveLength(README_MAX_CHARS)
  })
})

describe('clampExtracted', () => {
  const base: ExtractedPlugin = {
    slug: '1-root', name: 'n', url: 'https://github.com/a/b', description: 'd', payloadVersionRange: '^3', keywords: ['k'], isOfficial: false,
  }

  it('bounds oversized text and drops non-string values', () => {
    const out = clampExtracted({
      ...base,
      name: 'n'.repeat(50_000),
      packageName: 'p'.repeat(50_000),
      description: 'd'.repeat(50_000),
      payloadVersionRange: 'v'.repeat(50_000),
      keywords: Array.from({ length: 500 }, () => 'k'.repeat(50_000)),
    })
    expect(out.description).toHaveLength(DESCRIPTION_MAX_CHARS)
    expect(out.name.length).toBeLessThan(1000)
    expect(out.packageName!.length).toBeLessThan(1000)
    expect(out.payloadVersionRange!.length).toBeLessThan(1000)
    expect(out.keywords).toHaveLength(KEYWORDS_MAX)
    expect(out.keywords.every((k) => k.length <= 100)).toBe(true)
    expect(clampExtracted({ ...base, description: { a: 1 } as unknown as string }).description).not.toBe('[object Object]')
  })
})

describe('clampExtractedTemplate', () => {
  const base: ExtractedTemplate = {
    slug: '5-root', name: 'n', path: null, url: 'https://github.com/a/b', description: 'd', payloadVersionRange: null,
    stack: 'other', dependencyNames: [], license: 'MIT', lastUpdatedAt: null, isOfficial: false,
  }

  it('clamps an oversized license to 200 characters and turns an empty one into null', () => {
    expect(LICENSE_MAX_CHARS).toBe(200)
    expect(clampExtractedTemplate({ ...base, license: 'L'.repeat(60_000) }).license).toHaveLength(200)
    expect(clampExtractedTemplate({ ...base, license: '' }).license).toBeNull()
    expect(clampExtractedTemplate({ ...base, license: '   ' }).license).toBeNull()
    expect(clampExtractedTemplate({ ...base, license: null }).license).toBeNull()
    expect(clampExtractedTemplate(base).license).toBe('MIT')
  })

  it('bounds name, description, path and README like plugins', () => {
    const out = clampExtractedTemplate({ ...base, name: 'n'.repeat(1_000), description: 'd'.repeat(60_000), path: 'p'.repeat(1_000), readme: 'r'.repeat(README_MAX_CHARS + 10) })
    expect(out.name).toHaveLength(200)
    expect(out.description).toHaveLength(DESCRIPTION_MAX_CHARS)
    expect(out.path).toHaveLength(500)
    expect(out.readme!.length).toBeLessThanOrEqual(README_MAX_CHARS)
  })
})
