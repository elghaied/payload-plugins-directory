import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { runEnrichCommand } from '@/cli/enrich'
import { previewEnrichment } from '@/enrich/preview'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy } from './helpers/taxonomy'

let payload: Payload

const jobs = (task: string) => payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: task } } })

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await createTestTaxonomy(payload)
  const repo = await createRepo(payload)
  for (const [slug, healthScore, readme, visibility] of [
    ['a', 90, '# A', 'listed'], ['b', 80, '# B', 'listed'], ['c', 70, null, 'listed'], ['d', 95, '# D', 'hidden'], ['e', 10, '# E', 'listed'],
  ] as const) {
    await createPlugin(payload, repo.id, { slug, healthScore, readme, visibility, contentHash: `h-${slug}` })
  }
})
afterAll(async () => resetDatabase(payload))

describe('previewEnrichment', () => {
  it('previews the healthiest listed plugins with a README, calls no API and writes nothing', async () => {
    const items = await previewEnrichment(payload, { limit: 3 })
    expect(items.map((i) => i.slug)).toEqual(['a', 'b', 'e'])
    expect(items[0]).toMatchObject({ model: 'claude-sonnet-5-5', estOutputTokens: 1000 })
    expect(items[0].systemChars).toBeGreaterThan(500)
    expect(items[0].userChars).toBeGreaterThan(0)
    expect(items[0].estInputTokens).toBeGreaterThan(0)
    expect(items[0].estCostCachedUsd).toBeLessThan(items[0].estCostUsd)
    expect(await payload.count({ collection: 'plugins', overrideAccess: true, where: { 'ai.enrichedAt': { exists: true } } })).toMatchObject({ totalDocs: 0 })
    expect(await payload.count({ collection: 'tags', overrideAccess: true, where: { createdBy: { equals: 'ai' } } })).toMatchObject({ totalDocs: 0 })
    expect((await jobs('enrich')).totalDocs).toBe(0)
  })

  it('previews exactly the requested slugs', async () => {
    expect((await previewEnrichment(payload, { slugs: ['e', 'missing'] })).map((i) => i.slug)).toEqual(['e'])
  })
})

describe('enrich CLI handler', () => {
  it('queue mode queues one enrich job per found slug', async () => {
    await runEnrichCommand(payload, { mode: 'queue', slugs: 'a, b, missing', limit: '5' })
    expect((await jobs('enrich')).totalDocs).toBe(2)
    await expect(runEnrichCommand(payload, { mode: 'queue', slugs: '', limit: '5' })).rejects.toThrow(/--slugs/)
  })

  it('all mode queues a forced enrich-all on the default queue', async () => {
    await runEnrichCommand(payload, { mode: 'all', slugs: '', limit: '5' })
    const res = await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'enrich-all' } } })
    expect(res.docs).toHaveLength(1)
    expect(res.docs[0]).toMatchObject({ queue: 'default', input: { force: true } })
  })

  it('preview mode writes nothing and unknown modes are rejected', async () => {
    await runEnrichCommand(payload, { mode: 'preview', slugs: '', limit: '2' })
    expect((await jobs('enrich')).totalDocs).toBe(0)
    await expect(runEnrichCommand(payload, { mode: 'nope', slugs: '', limit: '5' })).rejects.toThrow(/Unknown --mode/)
  })
})
