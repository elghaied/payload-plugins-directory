import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { runSyncRepository } from '@/sync/syncRepository'
import { ghRepo, json, pkg, raw, repoById, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext, syncFetch } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('taxonomy and enrichment schema', () => {
  it('builds category slug paths from the slug field, not the title', async () => {
    const parent = await payload.create({ collection: 'categories', overrideAccess: true, context: { computeHierarchyPaths: true }, data: { title: 'Storage & Media', slug: 'storage-media' } })
    const child = await payload.create({
      collection: 'categories', overrideAccess: true, context: { computeHierarchyPaths: true },
      data: { title: 'Cloud storage (S3, R2)', slug: 'cloud-storage', parent: parent.id },
    })
    expect(parent._h_slugPath).toBe('storage-media')
    expect(child._h_slugPath).toBe('storage-media/cloud-storage')
  })

  it('rejects reserved and malformed category and tag slugs', async () => {
    await expect(payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'U', slug: 'uncategorized' } })).rejects.toThrow()
    await expect(payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'All', slug: 'all' } })).rejects.toThrow()
    await expect(payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'Bad', slug: 'Bad Slug' } })).rejects.toThrow()
  })

  it('hides enrichment failure fields from the public and keeps the rest of `ai` readable', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, {
      slug: 'p1',
      ai: { tagline: 'Visible', promptHash: 'f', failure: 'refusal:cyber', failedAt: NOW.toISOString(), failedKey: 'h:f' },
    })
    const anon = await payload.find({ collection: 'plugins', overrideAccess: false, user: null, where: { slug: { equals: 'p1' } } })
    expect(anon.docs[0].ai?.tagline).toBe('Visible')
    expect(anon.docs[0].ai?.failure).toBeUndefined()
    expect(anon.docs[0].ai?.failedKey).toBeUndefined()
    const admin = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: 'p1' } } })
    expect(admin.docs[0].ai).toMatchObject({ failure: 'refusal:cyber', failedKey: 'h:f' })
  })

  it('keeps query presets admin-only', async () => {
    await expect(payload.find({ collection: 'payload-query-presets', overrideAccess: false, user: null })).rejects.toThrow()
  })

  it('stores npm keywords written by sync', async () => {
    const f = syncFetch({
      [repoById(7)]: json(ghRepo(7, 'acme/payload-seo')),
      [raw('acme/payload-seo', 'package.json')]: pkg({ name: 'payload-seo', keywords: ['seo', 'metadata'], peerDependencies: { payload: '^3.0.0' } }),
      [raw('acme/payload-seo', 'README.md')]: text('# SEO'),
    })
    await runSyncRepository(payload, { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, syncContext(f, NOW))
    const doc = (await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '7-root' } } })).docs[0]
    expect(doc.keywords).toEqual(['seo', 'metadata'])
  })
})
