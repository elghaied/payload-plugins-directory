import { describe, expect, it } from 'vitest'
import { parseCompareInput, parseSearchPluginsInput, parseSlugInput } from '@/mcp/input'

describe('parseSearchPluginsInput', () => {
  it('accepts a query with defaults', () => {
    expect(parseSearchPluginsInput({ query: 'seo' })).toEqual({ ok: true, value: { query: 'seo', limit: 10 } })
  })
  it('accepts filters, clamps limit', () => {
    expect(parseSearchPluginsInput({ query: '', payloadMajor: '3', category: 'auth', limit: 999 })).toEqual({
      ok: true,
      value: { query: '', payloadMajor: '3', category: 'auth', limit: 25 },
    })
    expect(parseSearchPluginsInput({ query: 'x', payloadMajor: 4 })).toMatchObject({ ok: true, value: { payloadMajor: '4' } })
  })
  it('rejects bad majors, bad category slugs and an empty request', () => {
    expect(parseSearchPluginsInput({ query: 'x', payloadMajor: '5' }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: 'x', category: '../etc' }).ok).toBe(false)
    expect(parseSearchPluginsInput({ query: '  ' }).ok).toBe(false)
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

