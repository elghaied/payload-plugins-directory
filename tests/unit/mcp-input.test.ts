import { describe, expect, it } from 'vitest'
import { parseCompareInput, parseKindInput, parseSearchPluginsInput, parseSlugInput } from '@/mcp/input'

describe('parseSearchPluginsInput', () => {
  it('accepts a query with defaults', () => {
    expect(parseSearchPluginsInput({ query: 'seo' })).toEqual({ ok: true, value: { query: 'seo', kind: 'plugin', limit: 10 } })
  })
  it('accepts filters, clamps limit', () => {
    expect(parseSearchPluginsInput({ query: '', payloadMajor: '3', category: 'auth', limit: 999 })).toEqual({
      ok: true,
      value: { query: '', kind: 'plugin', payloadMajor: '3', category: 'auth', limit: 25 },
    })
    expect(parseSearchPluginsInput({ query: 'x', payloadMajor: 4 })).toMatchObject({ ok: true, value: { payloadMajor: '4' } })
  })
  it('rejects bad majors, bad category slugs and an empty request', () => {
    expect(parseSearchPluginsInput({ query: 'x', payloadMajor: '5' }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x', category: '../etc' }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: '  ' }).ok).toBe(false)
  })
})

describe('kind', () => {
  it('accepts plugin, template and all; defaults to plugin', () => {
    for (const kind of ['plugin', 'template', 'all']) expect(parseSearchPluginsInput({ query: 'x', kind })).toMatchObject({ ok: true, value: { kind } })
    expect(parseSearchPluginsInput({ query: 'x' })).toMatchObject({ ok: true, value: { kind: 'plugin' } })
    expect(parseSearchPluginsInput({ query: 'x', kind: null })).toMatchObject({ ok: true, value: { kind: 'plugin' } })
  })
  it('rejects anything else', () => {
    for (const kind of ['evil', 'Plugin', 5, ['plugin'], {}]) expect(parseSearchPluginsInput({ query: 'x', kind }).ok).toBe(false)
  })
  it('with kind template, category is still a slug and payloadMajor applies', () => {
    expect(parseSearchPluginsInput({ query: '', kind: 'template', category: 'landing-pages', payloadMajor: '3' })).toMatchObject({
      ok: true,
      value: { kind: 'template', category: 'landing-pages', payloadMajor: '3' },
    })
    expect(parseSearchPluginsInput({ query: 'x', kind: 'template', category: '../x' }).ok).toBe(false)
  })
  it('a category is ambiguous across both kinds, so kind all refuses it', () => {
    expect(parseSearchPluginsInput({ query: 'x', kind: 'all', category: 'auth' }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x', kind: 'all', payloadMajor: '3' }).ok).toBe(true)
  })
  it('parseKindInput validates listCategories input', () => {
    expect(parseKindInput({})).toEqual({ ok: true, value: 'plugin' })
    expect(parseKindInput({ kind: 'all' })).toEqual({ ok: true, value: 'all' })
    expect(parseKindInput({ kind: 'evil' }).ok).toBe(false)
  })
})

describe('parseSlugInput / parseCompareInput', () => {
  it('validates slugs', () => {
    expect(parseSlugInput({ slug: '684372049-better-localized-fields' })).toEqual({ ok: true, value: '684372049-better-localized-fields' })
    expect(parseSlugInput({ slug: 'a b' }).ok).toBe(false)
    expect(parseSlugInput({}).ok).toBe(false)
  })
  it('needs 2–5 distinct valid slugs', () => {
    expect(parseCompareInput({ slugs: ['a', 'b', 'a'] })).toEqual({ ok: true, value: ['a', 'b'] })
    expect(parseCompareInput({ slugs: ['a'] }).ok).toBe(false)
    expect(parseCompareInput({ slugs: ['a', 'b', 'c', 'd', 'e', 'f'] }).ok).toBe(false)
    expect(parseCompareInput({ slugs: 'a,b' }).ok).toBe(false)
  })
})

describe('strict input validation', () => {
  it('rejects wrong types and over-long values', () => {
    expect(parseSearchPluginsInput({ query: 5 }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x'.repeat(501) }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x'.repeat(500) }).ok).toBe(true)
    expect(parseSearchPluginsInput({ query: 'x', limit: '5' }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x', limit: Number.NaN }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x', category: 7 }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x', payloadMajor: {} }).ok).toBe(false)
    expect(parseSearchPluginsInput([] as never).ok).toBe(false)
  })
  it('clamps limit into 1-25', () => {
    expect(parseSearchPluginsInput({ query: 'x', limit: 0 })).toMatchObject({ value: { limit: 1 } })
    expect(parseSearchPluginsInput({ query: 'x', limit: -4 })).toMatchObject({ value: { limit: 1 } })
    expect(parseSearchPluginsInput({ query: 'x', limit: 7.9 })).toMatchObject({ value: { limit: 7 } })
  })
  it('rejects over-long slugs, non-string slugs and oversized slug arrays', () => {
    expect(parseSlugInput({ slug: 'a'.repeat(201) }).ok).toBe(false)
    expect(parseSlugInput({ slug: 5 }).ok).toBe(false)
    expect(parseCompareInput({ slugs: ['a', 5] }).ok).toBe(false)
    expect(parseCompareInput({ slugs: Array.from({ length: 21 }, (_, i) => `s${i}`) }).ok).toBe(false)
  })
})

