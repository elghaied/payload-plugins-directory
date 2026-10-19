import { describe, expect, it } from 'vitest'
import {
  buildCategoryOptions, buildTagOptions, categoryPageData, matchesCategory, matchesTag, rankForCategory, resolveCategoryParam, resolveTagParam, UNCATEGORIZED,
} from '@/lib/directory/filters'
import type { PluginSummary } from '@/lib/directory/types'
import { categoryFilterHref, categoryHref, tagHref } from '@/lib/taxonomy/links'
import { toCategoryNodes } from '@/taxonomy/tree'

const nodes = toCategoryNodes([
  { id: 1, slug: 'storage-media', title: 'Storage & Media', _h_slugPath: 'storage-media' },
  { id: 2, slug: 'cloud-storage', title: 'Cloud storage', parent: 1, _h_slugPath: 'storage-media/cloud-storage' },
  { id: 3, slug: 'media-management', title: 'Media & images', parent: 1, _h_slugPath: 'storage-media/media-management' },
  { id: 4, slug: 'other', title: 'Other' },
])
const p = (slug: string, over: Partial<PluginSummary> = {}) => ({ slug, name: slug, healthScore: 50, weeklyDownloads: 0, ...over }) as PluginSummary
const plugins = [
  p('a', { categoryPath: 'storage-media/cloud-storage', tags: ['s3'], healthScore: 80, weeklyDownloads: 10 }),
  p('b', { categoryPath: 'storage-media/cloud-storage', tags: ['s3', 'seo'], healthScore: 80, weeklyDownloads: 50 }),
  p('c', { categoryPath: 'storage-media/media-management', healthScore: 90 }),
  p('d'),
]

describe('home filters', () => {
  const options = buildCategoryOptions(nodes, plugins)
  it('builds category options with depth and subtree counts', () => {
    expect(options.map((o) => [o.slug, o.depth, o.count])).toEqual([
      ['other', 0, 0], ['storage-media', 0, 3], ['cloud-storage', 1, 2], ['media-management', 1, 1],
    ])
  })
  it('matches a category subtree, uncategorized and all', () => {
    expect(plugins.filter((x) => matchesCategory(x, 'storage-media', options)).map((x) => x.slug)).toEqual(['a', 'b', 'c'])
    expect(plugins.filter((x) => matchesCategory(x, 'cloud-storage', options)).map((x) => x.slug)).toEqual(['a', 'b'])
    expect(plugins.filter((x) => matchesCategory(x, UNCATEGORIZED, options)).map((x) => x.slug)).toEqual(['d'])
    expect(plugins.filter((x) => matchesCategory(x, 'all', options))).toHaveLength(4)
    expect(plugins.filter((x) => matchesCategory(x, 'unknown', options))).toHaveLength(0)
  })
  it('matches tags and lists only used tags, most used first', () => {
    expect(plugins.filter((x) => matchesTag(x, 'seo')).map((x) => x.slug)).toEqual(['b'])
    expect(plugins.filter((x) => matchesTag(x, 'all'))).toHaveLength(4)
    expect(buildTagOptions([{ slug: 'seo', title: 'SEO' }, { slug: 's3', title: 'Amazon S3' }, { slug: 'x', title: 'Unused' }], plugins)).toEqual([
      { slug: 's3', title: 'Amazon S3', count: 2 }, { slug: 'seo', title: 'SEO', count: 1 },
    ])
  })
})

describe('category pages', () => {
  it('ranks by health, then downloads, then name', () => {
    expect([...plugins].sort(rankForCategory).map((x) => x.slug)).toEqual(['c', 'b', 'a', 'd'])
  })
  it('builds the page for a path: trail, children with counts, subtree plugins ranked', () => {
    const page = categoryPageData('storage-media', nodes, plugins)!
    expect(page.node.slug).toBe('storage-media')
    expect(page.trail.map((n) => n.slug)).toEqual(['storage-media'])
    expect(page.children.map((c) => [c.slug, c.count])).toEqual([['cloud-storage', 2], ['media-management', 1]])
    expect(page.plugins.map((x) => x.slug)).toEqual(['c', 'b', 'a'])
    expect(categoryPageData('storage-media/cloud-storage', nodes, plugins)!.trail.map((n) => n.slug)).toEqual(['storage-media', 'cloud-storage'])
    expect(categoryPageData('nope', nodes, plugins)).toBeNull()
  })
  it('builds links', () => {
    expect(categoryHref('storage-media/cloud-storage')).toBe('/categories/storage-media/cloud-storage')
    expect(tagHref('s3')).toBe('/?tag=s3')
    expect(categoryFilterHref('cloud-storage')).toBe('/?category=cloud-storage')
  })
})

describe('URL filter validation', () => {
  const opts = [
    { slug: 'storage-media', title: 'Storage & Media', path: 'storage-media', depth: 0, count: 2 },
    { slug: 'cloud-storage', title: 'Cloud storage', path: 'storage-media/cloud-storage', depth: 1, count: 2 },
    { slug: 'empty-cat', title: 'Empty', path: 'empty-cat', depth: 0, count: 0 },
  ]
  const tagOpts = [{ slug: 's3', title: 'S3', count: 2 }]
  it('keeps a valid child slug', () => expect(resolveCategoryParam('cloud-storage', opts, 0)).toBe('cloud-storage'))
  it('resets a known but empty category', () => expect(resolveCategoryParam('empty-cat', opts, 0)).toBe('all'))
  it('resets unknown categories and missing values', () => {
    expect(resolveCategoryParam('bogus', opts, 0)).toBe('all')
    expect(resolveCategoryParam(null, opts, 0)).toBe('all')
  })
  it('uncategorized depends on its count', () => {
    expect(resolveCategoryParam(UNCATEGORIZED, opts, 0)).toBe('all')
    expect(resolveCategoryParam(UNCATEGORIZED, opts, 3)).toBe(UNCATEGORIZED)
  })
  it('tags: keeps known, resets unknown', () => {
    expect(resolveTagParam('s3', tagOpts)).toBe('s3')
    expect(resolveTagParam('nope', tagOpts)).toBe('all')
    expect(resolveTagParam(null, tagOpts)).toBe('all')
  })
})
