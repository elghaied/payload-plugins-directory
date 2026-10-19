import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import { clampLimit, runEnrichCommand } from '@/cli/enrich'
import { PRICES, previewEnrichment } from '@/enrich/preview'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy, setAiSettings } from './helpers/taxonomy'

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
    expect((await jobs('enrich-all')).totalDocs).toBe(0)
    expect((await payload.db.drizzle.select().from(jobStatus)).length).toBe(0)
  })

  it('prices the default model from the table; an unknown model is flagged', async () => {
    const [a] = await previewEnrichment(payload, { limit: 1 })
    const p = PRICES['claude-sonnet-5-5']
    const sys = Math.ceil(a.systemChars / 4)
    const rest = a.estInputTokens - sys
    expect(a.priceKnown).toBe(true)
    expect(a.estCostUsd).toBeCloseTo((sys * p.cacheWrite + rest * p.input + 1000 * p.output) / 1e6, 8)
    expect(a.estCostCachedUsd).toBeCloseTo((sys * p.cacheRead + rest * p.input + 1000 * p.output) / 1e6, 8)
    await setAiSettings(payload, { model: 'claude-mystery-9' })
    const [b] = await previewEnrichment(payload, { limit: 1 })
    expect(b).toMatchObject({ priceKnown: false, model: 'claude-mystery-9' })
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

  it('all mode does not queue a second enrich-all while one is pending', async () => {
    await runEnrichCommand(payload, { mode: 'all', slugs: '', limit: '5' })
    await runEnrichCommand(payload, { mode: 'all', slugs: '', limit: '5' })
    expect((await jobs('enrich-all')).totalDocs).toBe(1)
  })

  it('clamps the limit to 1..50, default 5', () => {
    expect([clampLimit('0'), clampLimit('-3'), clampLimit('abc'), clampLimit('2.9'), clampLimit('500')]).toEqual([5, 5, 5, 2, 50])
  })

  it('preview mode writes nothing and unknown modes are rejected', async () => {
    await runEnrichCommand(payload, { mode: 'preview', slugs: '', limit: '2' })
    expect((await jobs('enrich')).totalDocs).toBe(0)
    await expect(runEnrichCommand(payload, { mode: 'nope', slugs: '', limit: '5' })).rejects.toThrow(/Unknown --mode/)
  })
})
