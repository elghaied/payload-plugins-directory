import { describe, expect, it } from 'vitest'
import { buildPrefixQuery, escapeLike, MAX_QUERY_LENGTH, normalizeQuery } from '@/lib/search/query'

describe('normalizeQuery', () => {
  it.each([[''], ['   '], ['\n\t '], [undefined], [null], [42], [['seo']]])('returns null for %j', (raw) => {
    expect(normalizeQuery(raw)).toBeNull()
  })
  it('trims and collapses whitespace', () => {
    expect(normalizeQuery('  seo   plugin ')).toEqual({ text: 'seo plugin', prefix: "'seo':* & 'plugin':*", truncated: false })
  })
  it('truncates very long input by code points and flags it', () => {
    const q = normalizeQuery('a'.repeat(10_000))!
    expect(q.text).toHaveLength(MAX_QUERY_LENGTH)
    expect(q.truncated).toBe(true)
    expect(q.prefix).toBe(`'${'a'.repeat(32)}':*`)
  })
  it('keeps operator-only input as text but builds no prefix query', () => {
    expect(normalizeQuery(`'"&|!:*()<>\\%_`)).toEqual({ text: `'"&|!:*()<>\\%_`, prefix: '', truncated: false })
  })
  it('builds prefix tokens from letters and digits only (SQL-shaped input is inert)', () => {
    expect(normalizeQuery("'; drop table search; --")!.prefix).toBe("'drop':* & 'table':* & 'search':*")
  })
  it('handles unicode letters', () => {
    expect(normalizeQuery('Größe 日本')!.prefix).toBe("'größe':* & '日本':*")
  })
  it('strips control characters including NUL', () => {
    expect(normalizeQuery('a\u0000b\u0007c')!.text).toBe('a b c')
  })
  it('does not split emoji into lone surrogates when truncating', () => {
    const q = normalizeQuery('🙂'.repeat(300))!
    expect(Array.from(q.text)).toHaveLength(MAX_QUERY_LENGTH)
    expect(q.prefix).toBe('')
  })
})

describe('normalizeQuery hardening', () => {
  it('bounds the work for a huge input (slices before any regex)', () => {
    const start = performance.now()
    const q = normalizeQuery('seo '.repeat(2_500_000))!
    expect(performance.now() - start).toBeLessThan(100)
    expect(q.truncated).toBe(true)
    expect(Array.from(q.text).length).toBeLessThanOrEqual(MAX_QUERY_LENGTH)
  })
  it('applies NFKC so full-width and compatibility forms match their plain spelling', () => {
    expect(normalizeQuery('ＳＥＯ　ｐｌｕｇｉｎ')).toMatchObject({ text: 'SEO plugin', prefix: "'seo':* & 'plugin':*" })
    expect(normalizeQuery('ﬁle')!.text).toBe('file')
  })
  it('composes combining marks', () => {
    expect(normalizeQuery('cafe\u0301')!.text).toBe('caf\u00e9')
    expect(normalizeQuery('cafe\u0301')!.prefix).toBe("'caf\u00e9':*")
  })
  it('replaces lone surrogates instead of passing them to Postgres', () => {
    expect(normalizeQuery('a\ud800b')!.text).not.toMatch(/[\ud800-\udfff]/)
  })
  it('drops one-character prefix tokens (a:* would match every row)', () => {
    expect(normalizeQuery('a')!.prefix).toBe('')
    expect(normalizeQuery('a b seo')!.prefix).toBe("'seo':*")
    expect(normalizeQuery('a:*')!.prefix).toBe('')
  })
  it('quotes every prefix token', () => {
    expect(buildPrefixQuery('seo next')).toBe("'seo':* & 'next':*")
  })
})

describe('buildPrefixQuery', () => {
  it('dedupes and caps at 8 tokens', () => {
    expect(buildPrefixQuery('aa bb cc dd ee ff gg hh ii jj aa')).toBe("'aa':* & 'bb':* & 'cc':* & 'dd':* & 'ee':* & 'ff':* & 'gg':* & 'hh':*")
  })
  it('lower-cases', () => {
    expect(buildPrefixQuery('S3 Storage')).toBe("'s3':* & 'storage':*")
  })
})

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('100%_\\')).toBe('100\\%\\_\\\\')
  })
})
