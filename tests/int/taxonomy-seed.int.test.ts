import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { AI_PRESETS } from '@/enrich/presets'
import { applyAliasTagsToAll, seedTaxonomy, unmappedTopics } from '@/taxonomy/seed'
import { STARTER_CATEGORIES, STARTER_TAGS } from '@/taxonomy/starter'
import { flattenStarter } from '@/taxonomy/tree'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const tagIds = (v: unknown) => ((v ?? []) as (number | { id: number })[]).map((t) => (typeof t === 'object' ? t.id : t)).sort((a, b) => a - b)

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('seedTaxonomy', () => {
  it('creates the starter tree with parents, tags with aliases and the admin presets', async () => {
    const flat = flattenStarter(STARTER_CATEGORIES)
    const r = await seedTaxonomy(payload)
    expect(r.categoriesCreated).toHaveLength(flat.length)
    expect(r.tagsCreated).toHaveLength(STARTER_TAGS.length)
    expect(r.presetsCreated).toEqual(AI_PRESETS.map((p) => p.title))

    // F1: the path is requested explicitly, never assumed.
    const cloud = (
      await payload.find({
        collection: 'categories',
        overrideAccess: true,
        context: { computeHierarchyPaths: true },
        where: { slug: { equals: 'cloud-storage' } },
      })
    ).docs[0]
    expect(cloud._h_slugPath).toBe('storage-media/cloud-storage')
    const s3 = (await payload.find({ collection: 'tags', overrideAccess: true, where: { slug: { equals: 's3' } } })).docs[0]
    expect(s3).toMatchObject({ createdBy: 'alias', aliases: ['s3', 'aws-s3', 'amazon-s3'] })

    const presets = await payload.find({ collection: 'payload-query-presets', overrideAccess: true, sort: 'title' })
    expect(presets.docs.map((p) => [p.title, p.relatedCollection, p.isShared])).toEqual([
      ['Enrichment failed', 'plugins', true], ['Low confidence', 'plugins', true], ['Uncategorized', 'plugins', true],
    ])
  })

  it('is idempotent and never edits or re-parents what admins changed', async () => {
    await seedTaxonomy(payload)
    const seo = (await payload.find({ collection: 'categories', overrideAccess: true, where: { slug: { equals: 'seo' } } })).docs[0]
    await payload.update({ collection: 'categories', id: seo.id, overrideAccess: true, data: { title: 'Search engines', parent: null } })
    const again = await seedTaxonomy(payload)
    expect(again).toEqual({ categoriesCreated: [], tagsCreated: [], presetsCreated: [] })
    const after = await payload.findByID({ collection: 'categories', id: seo.id, overrideAccess: true, depth: 0 })
    expect(after).toMatchObject({ title: 'Search engines', parent: null })
  })

  it('skips categories and tags an admin already created with the same slug', async () => {
    const cat = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'My storage', slug: 'storage-media', intro: 'Mine' } })
    const tag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'My S3', slug: 's3', aliases: ['mine'] } })
    const r = await seedTaxonomy(payload)
    expect(r.categoriesCreated).not.toContain('storage-media')
    expect(r.tagsCreated).not.toContain('s3')
    expect(await payload.findByID({ collection: 'categories', id: cat.id, overrideAccess: true, depth: 0 })).toMatchObject({ title: 'My storage', intro: 'Mine' })
    expect(await payload.findByID({ collection: 'tags', id: tag.id, overrideAccess: true, depth: 0 })).toMatchObject({ title: 'My S3', aliases: ['mine'] })
    const child = (await payload.find({ collection: 'categories', overrideAccess: true, depth: 0, where: { slug: { equals: 'cloud-storage' } } })).docs[0]
    expect(child.parent).toBe(cat.id)
  })

  it('does not queue revalidation jobs while seeding', async () => {
    await seedTaxonomy(payload)
    expect((await payload.count({ collection: 'payload-jobs', overrideAccess: true })).totalDocs).toBe(0)
  })
})

describe('alias tags', () => {
  it('adds alias-mapped tags from repository topics and npm keywords, keeping existing tags', async () => {
    await seedTaxonomy(payload)
    const manual = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'Manual', slug: 'manual' } })
    const repo = await createRepo(payload, { topics: ['payload-plugin', 'aws-s3', 'some-odd-topic'] })
    const plugin = await createPlugin(payload, repo.id, { slug: 'p1', keywords: ['stripe'], _h_tags: [manual.id] })
    const idOf = async (slug: string) => (await payload.find({ collection: 'tags', overrideAccess: true, where: { slug: { equals: slug } } })).docs[0].id

    expect(await applyAliasTagsToAll(payload)).toEqual({ updated: ['p1'] })
    const doc = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 0 })
    expect(tagIds(doc._h_tags)).toEqual([manual.id, await idOf('s3'), await idOf('stripe')].sort((a, b) => a - b))
    expect(await applyAliasTagsToAll(payload)).toEqual({ updated: [] })
    expect(await unmappedTopics(payload)).toEqual([{ topic: 'some-odd-topic', count: 1 }])
  })

  it('skips plugins whose tags are locked by an admin', async () => {
    await seedTaxonomy(payload)
    const repo = await createRepo(payload, { topics: ['aws-s3'] })
    const plugin = await createPlugin(payload, repo.id, { slug: 'locked', keywords: ['stripe'], locks: { tags: true } })
    expect(await applyAliasTagsToAll(payload)).toEqual({ updated: [] })
    const doc = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 0 })
    expect(tagIds(doc._h_tags)).toEqual([])
  })
})
