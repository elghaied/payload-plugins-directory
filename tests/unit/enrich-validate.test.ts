import { describe, expect, it } from 'vitest'
import type { TagRef } from '@/enrich/types'
import { cleanText, slugifyTag, validateEnrichment } from '@/enrich/validate'

const tags: TagRef[] = [
  { id: 1, slug: 's3', title: 'Amazon S3', aliases: ['aws-s3'], createdBy: 'admin' },
  { id: 2, slug: 'seo', title: 'SEO', aliases: ['meta-tags'], createdBy: 'admin' },
]
const ctx = { leafSlugs: new Set(['cloud-storage', 'other']), tags, maxNewTags: 2 }
const good = {
  category: 'cloud-storage', tags: ['s3'], tagline: 'Store Payload uploads in Amazon S3',
  summary: 'Adds an S3 storage adapter to Payload.', features: ['S3 adapter', 'Presigned uploads', 'Prefixes'],
  useCases: ['Serve media from S3'], confidence: 0.8,
}
const ok = (raw: unknown, c = ctx) => {
  const r = validateEnrichment(raw, c)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('validateEnrichment', () => {
  it('accepts a valid answer', () => {
    expect(ok(good)).toEqual({ ...good, tags: { existing: ['s3'], created: [] } })
  })
  it('rejects non-objects', () => {
    for (const raw of [null, [], 'x', 42]) expect(validateEnrichment(raw, ctx)).toEqual({ ok: false, error: 'invalid-output: not an object' })
  })
  it('falls back to "other" for unknown or non-leaf categories, and fails when "other" is missing', () => {
    for (const category of ['hacked', 'storage-media', undefined, 7, '']) expect(ok({ ...good, category }).category).toBe('other')
    const noOther = { ...ctx, leafSlugs: new Set(['cloud-storage']) }
    for (const category of ['hacked', undefined]) {
      expect(validateEnrichment({ ...good, category }, noOther)).toMatchObject({ ok: false, error: expect.stringMatching(/^invalid-output: unknown category/) })
    }
  })
  it('clamps confidence and treats non-numeric as 0', () => {
    expect(ok({ ...good, confidence: 1.7 }).confidence).toBe(1)
    expect(ok({ ...good, confidence: -0.2 }).confidence).toBe(0)
    for (const confidence of ['high', Number.NaN, Infinity, null, undefined]) expect(ok({ ...good, confidence }).confidence).toBe(0)
  })
  it('rejects answers whose text is empty after cleaning, or without features or use cases', () => {
    expect(validateEnrichment({ ...good, tagline: '<b></b>' }, ctx)).toMatchObject({ ok: false })
    expect(validateEnrichment({ ...good, summary: '   ' }, ctx)).toMatchObject({ ok: false })
    expect(validateEnrichment({ ...good, features: [' ', 3] }, ctx)).toMatchObject({ ok: false })
    expect(validateEnrichment({ ...good, features: [] }, ctx)).toMatchObject({ ok: false })
    expect(validateEnrichment({ ...good, useCases: 'Use it' }, ctx)).toMatchObject({ ok: false })
  })
  it('ignores keys outside the contract', () => {
    const value = ok({ ...good, visibility: 'hidden', healthScore: 100, stars: 1e6, featured: true })
    expect(Object.keys(value).sort()).toEqual(['category', 'confidence', 'features', 'summary', 'tagline', 'tags', 'useCases'])
  })
  it('clamps over-long text, caps and de-duplicates lists', () => {
    const value = ok({
      ...good,
      tagline: 'word '.repeat(60),
      summary: 'Sentence. '.repeat(100),
      features: [...Array.from({ length: 8 }, (_, i) => `Feature ${i} ${'x'.repeat(150)}`), 'dup', 'DUP'],
      useCases: ['A', 'a', ' ', 'B', 'C', 'D'],
    })
    expect(value.tagline.length).toBeLessThanOrEqual(120)
    expect(value.tagline.endsWith('…')).toBe(true)
    expect(value.summary.length).toBeLessThanOrEqual(600)
    expect(value.features).toHaveLength(6)
    for (const f of value.features) expect(f.length).toBeLessThanOrEqual(120)
    expect(value.useCases).toEqual(['A', 'B', 'C'])
    expect(ok({ ...good, features: ['one'] }).features).toEqual(['one'])
  })
  it('maps tags to existing slugs, drops unknown ones and caps new tags', () => {
    const value = ok({
      ...good,
      tags: [
        'S3', 'aws-s3', 'Amazon S3', 'unknown-slug', { new: 'SEO' }, { new: 'Presigned uploads' },
        { new: 'Way too many words in here' }, { new: 'https://evil.example' }, { new: 'Image CDN' }, { new: 'Third new tag' }, 7,
      ],
    })
    expect(value.tags).toEqual({
      existing: ['s3', 'seo'],
      created: [{ slug: 'presigned-uploads', title: 'Presigned uploads' }, { slug: 'image-cdn', title: 'Image CDN' }],
    })
    expect(ok({ ...good, tags: [{ new: 'Presigned uploads' }] }, { ...ctx, maxNewTags: 0 }).tags.created).toEqual([])
    expect(ok({ ...good, tags: [{ new: 'All' }, { new: 'Featured' }, { new: 'Uncategorized' }] }).tags.created).toEqual([])
  })
  it('rejects new tag titles outside the charset, too long, or containing links', () => {
    const created = (titles: unknown[]) => ok({ ...good, tags: titles.map((t) => ({ new: t })) }, { ...ctx, maxNewTags: 10 }).tags.created.map((c) => c.title)
    expect(created(['Café', 'Ünï', '日本語', 'a<b>c', 'x*y', 'evil.com', 'me@evil.com', 'a'.repeat(41), 'Ａ' + 'b'.repeat(40), '', '   ', '+++', 5, null, 'two\nlines ok'])).toEqual(['two lines ok'])
    expect(created(['C++', 'Node.js', 'Next.js/React', 'Ａｐｉ'])).toEqual(['C++', 'Node.js', 'Next.js/React', 'Api'])
  })
  it('generated slugs are valid and de-duplicate case-insensitively against slugs, titles and aliases', () => {
    const value = ok(
      { ...good, tags: [{ new: 'AMAZON s3' }, { new: 'Aws S3' }, { new: 'Meta Tags' }, { new: 'seo' }, { new: 'Edge Cache' }, { new: 'edge   cache' }, { new: 'EDGE-CACHE' }] },
      { ...ctx, maxNewTags: 5 },
    )
    expect(value.tags.existing).toEqual(['s3', 'seo'])
    expect(value.tags.created).toEqual([{ slug: 'edge-cache', title: 'Edge Cache' }])
    for (const c of value.tags.created) expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })
  it('never creates more than maxNewTags and handles odd limits', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ new: `Tag ${String.fromCharCode(97 + i)}` }))
    expect(ok({ ...good, tags: many }, { ...ctx, maxNewTags: 3 }).tags.created).toHaveLength(3)
    for (const maxNewTags of [-1, Number.NaN, 0]) expect(ok({ ...good, tags: many }, { ...ctx, maxNewTags }).tags.created).toEqual([])
  })
  it('keeps at most six tags in total', () => {
    const many: TagRef[] = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, slug: `t${i}`, title: `T${i}`, aliases: [], createdBy: 'admin' }))
    expect(ok({ ...good, tags: many.map((t) => t.slug) }, { ...ctx, tags: many }).tags.existing).toHaveLength(6)
    const mixed = ok({ ...good, tags: [...many.slice(0, 5).map((t) => t.slug), { new: 'One' }, { new: 'Two' }] }, { ...ctx, tags: many, maxNewTags: 5 })
    expect(mixed.tags.existing.length + mixed.tags.created.length).toBe(6)
  })
})

describe('cleanText', () => {
  it('strips HTML, markdown links and markers, URLs, domains and e-mail addresses', () => {
    expect(cleanText('<script>alert(1)</script>Hello <b>world</b>', 100)).toBe('alert(1)Hello world')
    expect(cleanText('See [the docs](https://x.dev/docs) at https://evil.example/p or www.evil.example', 200)).toBe('See the docs at or')
    expect(cleanText('Mail me@evil.com or visit evil.com/x today', 100)).toBe('Mail or visit today')
    expect(cleanText('## Title\n> quote **bold** `x`', 100)).toBe('Title quote bold x')
    expect(cleanText('Works with Next.js and payload.config.ts', 100)).toBe('Works with Next.js and payload.config.ts')
  })
  it('removes control and bidi characters, and does not let them hide links', () => {
    expect(cleanText('safe‮txt.exe​\u0000', 100)).toBe('safe txt.exe')
    expect(cleanText('visit evil​.com now', 100)).toBe('visit now')
    expect(cleanText('a\u0007b\tc\r\nd', 100)).toBe('a b c d')
  })
  it('clamps at a word boundary with an ellipsis and handles non-strings', () => {
    expect(cleanText('one two three four five', 12)).toBe('one two…')
    expect(cleanText('short', 12)).toBe('short')
    expect(cleanText(42, 10)).toBe('')
  })
  it('never splits surrogate pairs and removes lone surrogates', () => {
    const out = cleanText('😀'.repeat(20), 11)
    expect(out.length).toBeLessThanOrEqual(11)
    expect(out.endsWith('…')).toBe(true)
    expect(() => encodeURIComponent(out)).not.toThrow()
    expect(cleanText('a\uD800b', 10)).toBe('a b')
  })
  it('slugifies tag titles', () => {
    expect(slugifyTag('Presigned Uploads!')).toBe('presigned-uploads')
    expect(slugifyTag('Café Déjà vu')).toBe('cafe-deja-vu')
    expect(slugifyTag('C++')).toBe('cpp')
    expect(slugifyTag('C#')).toBe('csharp')
    expect(slugifyTag('F#')).toBe('fsharp')
    expect(slugifyTag('.NET')).toBe('dotnet')
    expect(slugifyTag('Node.js')).toBe('node-js')
  })
  it('does not reuse a plain "c" tag for C++ or C#', () => {
    const c: TagRef[] = [{ id: 9, slug: 'c', title: 'C', aliases: [], createdBy: 'admin' }]
    const value = ok({ ...good, tags: [{ new: 'C++' }, { new: 'C#' }, { new: 'C' }] }, { ...ctx, tags: c, maxNewTags: 5 })
    expect(value.tags.created).toEqual([{ slug: 'cpp', title: 'C++' }, { slug: 'csharp', title: 'C#' }])
    expect(value.tags.existing).toEqual(['c'])
  })
  it('strips residue that survives a single pass', () => {
    expect(cleanText('<<b>script>alert(1)<</b>/script>', 100)).not.toMatch(/<|>/)
    expect(cleanText('<<b>script>alert(1)<</b>/script>', 100).toLowerCase()).not.toContain('<script')
    expect(cleanText('visit evil.**com now', 100)).toBe('visit now')
    expect(cleanText('javascript:alert(1)', 100)).toBe('alert(1)')
    expect(cleanText('x vbscript:y data:text/html,z', 100)).not.toMatch(/script:|data:/)
    expect(cleanText('<script src=x', 100)).not.toMatch(/[<>]/)
  })
  it('stays fast on 200 KB adversarial input', () => {
    const inputs = ['['.repeat(200_000), '<'.repeat(200_000), 'a.'.repeat(100_000), '[a](b'.repeat(40_000), '**'.repeat(100_000)]
    const start = performance.now()
    for (const input of inputs) {
      cleanText(input, 600)
      validateEnrichment({ ...good, summary: input, tags: [{ new: input }] }, ctx)
    }
    expect(performance.now() - start).toBeLessThan(200)
  })
})
