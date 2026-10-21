import { describe, expect, it } from 'vitest'
import { compareTemplatesDefault, filterTemplates, resolveTemplateParams, sortTemplates } from '@/lib/templates/filters'
import type { TemplateSummary } from '@/lib/templates/types'
import type { CategoryOption } from '@/lib/directory/filters'

const t = (over: Partial<TemplateSummary>): TemplateSummary => ({
  slug: 's', name: 'N', tagline: '', owner: 'o', ownerAvatar: '', repositoryUrl: '', url: '', isOfficial: false, stars: 0,
  payloadMajors: ['3'], stack: 'nextjs', lastUpdate: '2026-01-01', createdAt: '2025-01-01', image: { src: 'x', local: false }, ...over,
})
const website = t({ slug: 'website', name: 'website', isOfficial: true, stars: null })
const big = t({ slug: '1-root', name: 'Big', stars: 5000, lastUpdate: '2026-03-01' })
const small = t({ slug: '2-root', name: 'Alpha', stars: 10, stack: 'tanstack-start', payloadMajors: ['4'], tags: ['cms'], tagline: 'A blog kit', categoryPath: 'landing-pages', lastUpdate: '2026-06-01' })
const options: CategoryOption[] = [{ slug: 'landing-pages', title: 'Landing pages', path: 'landing-pages', depth: 0, count: 1 }]

describe('compareTemplatesDefault', () => {
  it('puts official before a 5000-star community repo, then stars, then name', () => {
    expect([big, website, small].sort(compareTemplatesDefault).map((x) => x.slug)).toEqual(['website', '1-root', '2-root'])
    const a = t({ slug: 'a', name: 'A', stars: 3 })
    const b = t({ slug: 'b', name: 'B', stars: 3 })
    expect([b, a].sort(compareTemplatesDefault).map((x) => x.slug)).toEqual(['a', 'b'])
  })
})

describe('sortTemplates', () => {
  it('sorts by stars, recent and name without mutating', () => {
    const list = [small, big, website]
    expect(sortTemplates(list, 'stars').map((x) => x.slug)).toEqual(['1-root', '2-root', 'website'])
    expect(sortTemplates(list, 'recent').map((x) => x.slug)).toEqual(['2-root', '1-root', 'website'])
    expect(sortTemplates(list, 'name').map((x) => x.name)).toEqual(['Alpha', 'Big', 'website'])
    expect(sortTemplates(list, 'default').map((x) => x.slug)).toEqual(['website', '1-root', '2-root'])
    expect(list[0]).toBe(small)
  })
})

describe('filterTemplates', () => {
  const list = [website, big, small]
  it('filters by stack', () => {
    expect(filterTemplates(list, { stack: 'tanstack-start' }, options)).toEqual([small])
  })
  it('filters by major and source', () => {
    expect(filterTemplates(list, { major: '4' }, options)).toEqual([small])
    expect(filterTemplates(list, { source: 'official' }, options)).toEqual([website])
    expect(filterTemplates(list, { source: 'community' }, options)).toEqual([big, small])
  })
  it('filters by category', () => {
    expect(filterTemplates(list, { category: 'landing-pages' }, options)).toEqual([small])
    expect(filterTemplates(list, { category: 'nope' }, options)).toEqual([])
  })
  it('matches q on name, tagline and tags case-insensitively', () => {
    expect(filterTemplates(list, { q: 'ALPHA' }, options)).toEqual([small])
    expect(filterTemplates(list, { q: 'blog' }, options)).toEqual([small])
    expect(filterTemplates(list, { q: 'CMS' }, options)).toEqual([small])
    expect(filterTemplates(list, { q: '  ' }, options)).toEqual(list)
  })
})

describe('resolveTemplateParams', () => {
  it('returns nothing for unknown values, never "all"', () => {
    expect(resolveTemplateParams(new URLSearchParams('stack=evil&sort=all'))).toEqual({})
    expect(resolveTemplateParams(new URLSearchParams('category=all&source=all&major=9&q='))).toEqual({})
  })
  it('keeps known values', () => {
    expect(resolveTemplateParams(new URLSearchParams('stack=nextjs&sort=stars&major=3&source=official&q=blog&category=landing-pages'))).toEqual({
      stack: 'nextjs', sort: 'stars', major: '3', source: 'official', q: 'blog', category: 'landing-pages',
    })
  })
  it('accepts a plain search params object', () => {
    expect(resolveTemplateParams({ stack: ['tanstack-start', 'x'], sort: 'recent' })).toEqual({ stack: 'tanstack-start', sort: 'recent' })
  })
})
