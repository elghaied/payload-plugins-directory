import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy } from './helpers/taxonomy'

vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

let payload: Payload
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const tax = await createTestTaxonomy(payload)
  const repo = await createRepo(payload)
  const make = (slug: string, over: Record<string, unknown>) => createPlugin(payload, repo.id, { slug, name: slug, ...over } as never)
  await make('a', { category: tax.cloud.id, healthScore: 80, npm: { weeklyDownloads: 10 }, _h_tags: [tax.s3.id], ai: { tagline: 'AI says A', summary: 'About A.', features: ['F'], useCases: ['U'] } })
  await make('b', { category: tax.cloud.id, healthScore: 80, npm: { weeklyDownloads: 50 }, customTagline: 'Maintainer says B', ai: { tagline: 'AI says B' } })
  await make('c', { category: tax.media.id, healthScore: 90 })
  await make('hidden', { category: tax.cloud.id, healthScore: 99, visibility: 'hidden', _h_tags: [tax.seo.id] })
  const trashed = await make('trashed', { category: tax.cloud.id, healthScore: 99 })
  await payload.update({ collection: 'plugins', id: trashed.id, overrideAccess: true, data: { deletedAt: new Date().toISOString() } })
  await make('d', { description: 'Author D' })
})
afterAll(async () => resetDatabase(payload))

describe('taxonomy queries', () => {
  it('puts tagline precedence, category path and tags on summaries', async () => {
    const { getPluginSummaries } = await import('@/lib/directory/queries')
    const bySlug = Object.fromEntries((await getPluginSummaries()).map((s) => [s.slug, s]))
    expect(Object.keys(bySlug).sort()).toEqual(['a', 'b', 'c', 'd'])
    expect(bySlug.a).toMatchObject({ description: 'AI says A', categoryPath: 'storage-media/cloud-storage', tags: ['s3'] })
    expect(bySlug.b.description).toBe('Maintainer says B')
    expect(bySlug.d).toMatchObject({ description: 'Author D' })
    expect(bySlug.d).not.toHaveProperty('categoryPath')
  })

  it('builds category pages from listed plugins only, ranked by health then downloads', async () => {
    const { getCategoryPage } = await import('@/lib/directory/taxonomy')
    const page = await getCategoryPage('storage-media')
    expect(page?.plugins.map((p) => p.slug)).toEqual(['c', 'b', 'a'])
    expect(page?.children.map((c) => [c.slug, c.count])).toEqual([['cloud-storage', 2], ['media-management', 1]])
    expect((await getCategoryPage('storage-media/cloud-storage'))?.trail.map((n) => n.slug)).toEqual(['storage-media', 'cloud-storage'])
    expect(await getCategoryPage('does-not/exist')).toBeNull()
  })

  it('reads real nested _h_slugPath values for the category tree', async () => {
    const { getCategoryNodes } = await import('@/lib/directory/taxonomy')
    const nodes = await getCategoryNodes()
    expect(nodes.find((n) => n.slug === 'cloud-storage')?.path).toBe('storage-media/cloud-storage')
    expect(nodes.find((n) => n.slug === 'storage-media')?.path).toBe('storage-media')
  })

  it('offers home filter options with counts that ignore hidden and trashed plugins', async () => {
    const { getHomeFilterOptions } = await import('@/lib/directory/taxonomy')
    const { categories, tags } = await getHomeFilterOptions()
    expect(categories.find((c) => c.slug === 'cloud-storage')?.count).toBe(2)
    expect(tags).toEqual([{ slug: 's3', title: 'Amazon S3', count: 1 }])
  })

  it('returns the AI overview, author description and taxonomy on the detail', async () => {
    const { getPluginDetail } = await import('@/lib/directory/queries')
    expect(await getPluginDetail('a')).toMatchObject({
      authorDescription: '',
      ai: { summary: 'About A.', features: ['F'], useCases: ['U'], generated: true },
      category: { slug: 'cloud-storage', title: 'Cloud storage', path: 'storage-media/cloud-storage' },
      tagList: [{ slug: 's3', title: 'Amazon S3' }],
    })
  })
})
