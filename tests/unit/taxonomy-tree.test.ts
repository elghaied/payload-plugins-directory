import { describe, expect, it } from 'vitest'
import { validateTaxonomySlug } from '@/taxonomy/slugs'
import { OTHER_CATEGORY_SLUG, STARTER_CATEGORIES, STARTER_TAGS } from '@/taxonomy/starter'
import {
  childrenOf, flattenStarter, isInSubtree, leafCategories, subtreeCounts, titlePathOf, toCategoryNodes, trailFor,
} from '@/taxonomy/tree'

describe('starter taxonomy', () => {
  const flat = flattenStarter(STARTER_CATEGORIES)

  it('has about ten top-level categories plus a top-level `other` leaf', () => {
    expect(STARTER_CATEGORIES.length).toBeGreaterThanOrEqual(10)
    expect(STARTER_CATEGORIES.length).toBeLessThanOrEqual(14)
    const other = STARTER_CATEGORIES.find((c) => c.slug === OTHER_CATEGORY_SLUG)
    expect(other).toBeDefined()
    expect(other?.children ?? []).toEqual([])
  })
  it('uses unique, valid slugs and titles without "/" (title paths are "/"-joined)', () => {
    const slugs = flat.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    for (const c of flat) {
      expect(validateTaxonomySlug(c.slug)).toBe(true)
      expect(c.title).not.toContain('/')
      expect(c.intro.length).toBeGreaterThan(30)
      expect(c.intro.length).toBeLessThanOrEqual(300)
    }
  })
  it('lists parents before children', () => {
    const seen = new Set<string>()
    for (const c of flat) {
      if (c.parentSlug) expect(seen.has(c.parentSlug)).toBe(true)
      seen.add(c.slug)
    }
  })
  it('covers the main Payload plugin areas with leaves', () => {
    const leaves = flat.filter((c) => !flat.some((x) => x.parentSlug === c.slug)).map((c) => c.slug)
    for (const s of ['cloud-storage', 'authentication', 'seo', 'payments', 'forms', 'email', 'search', 'localization', 'custom-fields', 'ai-content', 'analytics', 'importers', 'testing-dx', 'other']) {
      expect(leaves).toContain(s)
    }
  })
  it('seeds tags with unique valid slugs and unique lower-case aliases', () => {
    const slugs = STARTER_TAGS.map((t) => t.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
    const aliases = STARTER_TAGS.flatMap((t) => t.aliases)
    expect(new Set(aliases).size).toBe(aliases.length)
    for (const t of STARTER_TAGS) {
      expect(validateTaxonomySlug(t.slug)).toBe(true)
      for (const a of t.aliases) expect(a).toBe(a.toLowerCase())
    }
    expect(aliases).not.toContain('payload-plugin')
    for (const a of ['image', 'images', 'color', 'preview', 'queue', 'jobs', 'audit', 'wp', 'ai', 'mail']) expect(aliases).not.toContain(a)
  })
})

describe('tree utilities', () => {
  const nodes = toCategoryNodes([
    { id: 3, slug: 'cloud-storage', title: 'Cloud storage', parent: { id: 1 }, _h_slugPath: 'storage-media/cloud-storage' },
    { id: 1, slug: 'storage-media', title: 'Storage & Media', parent: null, _h_slugPath: 'storage-media' },
    { id: 4, slug: 'media-management', title: 'Media & images', parent: 1, _h_slugPath: 'storage-media/media-management' },
    { id: 9, slug: 'other', title: 'Other', intro: 'Everything else.' },
  ])

  it('normalises docs and sorts by path', () => {
    expect(nodes.map((n) => [n.path, n.parentId])).toEqual([
      ['other', null], ['storage-media', null], ['storage-media/cloud-storage', 1], ['storage-media/media-management', 1],
    ])
    expect(nodes[0]).toMatchObject({ intro: 'Everything else.', icon: null })
  })
  it('fails loudly when a child category has no _h_slugPath', () => {
    expect(() => toCategoryNodes([{ id: 2, slug: 'child', title: 'Child', parent: 1 }])).toThrow(/child.*_h_slugPath/)
    expect(() => toCategoryNodes([{ id: 1, slug: 'root', title: 'Root' }])).not.toThrow()
  })
  it('finds children, leaves, trails and title paths', () => {
    expect(childrenOf(nodes, 1).map((n) => n.slug)).toEqual(['cloud-storage', 'media-management'])
    expect(childrenOf(nodes, null).map((n) => n.slug)).toEqual(['other', 'storage-media'])
    expect(leafCategories(nodes).map((n) => n.slug)).toEqual(['other', 'cloud-storage', 'media-management'])
    expect(trailFor(nodes, 'storage-media/cloud-storage').map((n) => n.slug)).toEqual(['storage-media', 'cloud-storage'])
    expect(trailFor(nodes, 'nope')).toEqual([])
    expect(titlePathOf(nodes, nodes[2])).toBe('Storage & Media / Cloud storage')
  })
  it('matches subtrees by path prefix only on segment boundaries', () => {
    expect(isInSubtree('storage-media/cloud-storage', 'storage-media')).toBe(true)
    expect(isInSubtree('storage-media', 'storage-media')).toBe(true)
    expect(isInSubtree('storage-media-extra', 'storage-media')).toBe(false)
    expect(isInSubtree(undefined, 'storage-media')).toBe(false)
  })
  it('counts plugins per subtree', () => {
    const counts = subtreeCounts(nodes, ['storage-media/cloud-storage', 'storage-media/cloud-storage', 'other', undefined, 'gone/x'])
    expect(Object.fromEntries(counts)).toEqual({
      other: 1, 'storage-media': 2, 'storage-media/cloud-storage': 2, 'storage-media/media-management': 0,
    })
  })
})
