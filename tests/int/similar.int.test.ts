import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createPlugin, createRepo, trashPlugin } from './helpers/directory'

vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }))

let payload: Payload
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = (await createRepo(payload)).id
  const cat = (title: string, slug: string, parent?: number) =>
    payload.create({ collection: 'categories', overrideAccess: true, context: { skipRevalidate: true }, data: { title, slug, ...(parent ? { parent } : {}) } })
  const tag = (title: string, slug: string) =>
    payload.create({ collection: 'tags', overrideAccess: true, context: { skipRevalidate: true }, data: { title, slug } })
  const a = await cat('A', 'a')
  const aChild = await cat('A child', 'a-child', a.id)
  const b = await cat('B', 'b')
  const other = await cat('Other', 'other')
  const t1 = await tag('T1', 't1')
  const t2 = await tag('T2', 't2')
  await createPlugin(payload, repo, { slug: 'target', category: aChild.id, _h_tags: [t1.id, t2.id] })
  await createPlugin(payload, repo, { slug: 'same-cat', category: aChild.id, healthScore: 50 })
  await createPlugin(payload, repo, { slug: 'two-tags', category: b.id, _h_tags: [t1.id, t2.id], healthScore: 90 })
  await createPlugin(payload, repo, { slug: 'one-tag', category: b.id, _h_tags: [t1.id] })
  await createPlugin(payload, repo, { slug: 'hidden-twin', category: aChild.id, _h_tags: [t1.id, t2.id], visibility: 'hidden' })
  const trashed = await createPlugin(payload, repo, { slug: 'trashed-twin', category: aChild.id, _h_tags: [t1.id, t2.id] })
  await trashPlugin(payload, trashed.id)
  await createPlugin(payload, repo, { slug: 'other-1', category: other.id })
  await createPlugin(payload, repo, { slug: 'other-2', category: other.id })
})
afterAll(async () => resetDatabase(payload))

describe('getSimilarPlugins', () => {
  it('ranks by category and tag overlap, excluding self, hidden and trashed', async () => {
    const { getSimilarPlugins } = await import('@/lib/directory/queries')
    expect((await getSimilarPlugins('target')).map((p) => p.slug)).toEqual(['two-tags', 'same-cat', 'one-tag'])
  })
  it('does not treat the "other" category as similarity', async () => {
    const { getSimilarPlugins } = await import('@/lib/directory/queries')
    expect(await getSimilarPlugins('other-1')).toEqual([])
  })
  it('returns [] for unknown or hidden slugs', async () => {
    const { getSimilarPlugins } = await import('@/lib/directory/queries')
    expect(await getSimilarPlugins('nope')).toEqual([])
    expect(await getSimilarPlugins('hidden-twin')).toEqual([])
  })
})
