import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import Anthropic from '@anthropic-ai/sdk'
import { recordEnrichmentFailure } from '@/enrich/apply'
import {
  cancelBatchQuietly,
  clearInflight,
  customIdFor,
  DEFAULT_MAX_PER_PASS,
  DIRECT_MAX,
  findStalePlugins,
  maxPerPassFromEnv,
  readInflight,
  runEnrichAll,
  runEnrichBatch,
  type EnrichBatchInput,
} from '@/enrich/batch'
import { failureKey, loadEnrichContext } from '@/enrich/context'
import type { BatchResultEntry } from '@/enrich/types'
import type { Plugin } from '@/payload-types'
import { endBatch, fakeEnrichClient, maxTokensMessage, okMessage, refusalMessage } from '../helpers/fakeEnrichClient'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy, goodOutput, setAiSettings } from './helpers/taxonomy'

let payload: Payload
let plugins: Plugin[]
const LATER = () => new Date(Date.now() + 2 * 3_600_000) // past the edit debounce of the taxonomy created in beforeEach
const reload = (id: number) => payload.findByID({ collection: 'plugins', id, overrideAccess: true, depth: 0, trash: true })
const ok = (id: number): BatchResultEntry => ({ custom_id: customIdFor(id), result: { type: 'succeeded', message: okMessage(goodOutput()) } })

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await createTestTaxonomy(payload)
  const repo = await createRepo(payload)
  plugins = []
  for (const [i, health] of [10, 90, 50, 70, 30, 20].entries()) {
    plugins.push(await createPlugin(payload, repo.id, { slug: `p${i}`, contentHash: `h${i}`, readme: `# P${i}`, healthScore: health }))
  }
})
afterAll(async () => resetDatabase(payload))

describe('findStalePlugins', () => {
  it('finds never-enriched, changed and re-prompted plugins, skipping current, failed, locked and trashed ones', async () => {
    const { fingerprint } = await loadEnrichContext(payload)
    const [p0, p1, p2, p3, p4, p5] = plugins
    const set = (p: Plugin, data: Record<string, unknown>) => payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: data as never })
    await set(p0, { ai: { enrichedHash: 'h0', promptHash: fingerprint } }) // current
    await set(p1, { ai: { enrichedHash: 'old', promptHash: fingerprint } }) // content changed
    await set(p2, { ai: { enrichedHash: 'h2', promptHash: 'old-prompt' } }) // prompt changed
    await set(p3, { ai: { failedKey: failureKey('h3', fingerprint) } }) // same input already failed
    await set(p4, { locks: { category: true, tags: true, tagline: true, summary: true, features: true, useCases: true } })
    await set(p5, { deletedAt: new Date().toISOString() })
    expect((await findStalePlugins(payload, fingerprint)).map((p) => p.slug)).toEqual(['p1', 'p2'])
  })
})

describe('runEnrichAll', () => {
  it('queues direct jobs below the batch threshold, highest health first', async () => {
    const r = await runEnrichAll(payload, fakeEnrichClient(), LATER())
    expect(r).toMatchObject({ status: 'direct', stale: 6, batch: null })
    expect(r.direct).toEqual([plugins[1], plugins[3], plugins[2], plugins[4], plugins[5], plugins[0]].map((p) => p.id))
  })

  it('submits one batch without fallbacks at or above the threshold', async () => {
    const fake = fakeEnrichClient()
    const r = await runEnrichAll(payload, fake, LATER(), { batchMin: 3 })
    expect(r).toMatchObject({ status: 'batch', stale: 6, direct: [] })
    const { fingerprint } = await loadEnrichContext(payload)
    expect(r.batch).toMatchObject({ batchId: 'msgbatch_1', fingerprint, model: 'claude-sonnet-5-5' })
    expect(r.batch?.items).toHaveLength(6)
    const sent = fake.batches.get('msgbatch_1')!.items
    expect(sent.map((i) => i.custom_id)).toEqual(r.batch!.items.map((i) => customIdFor(i.id)))
    for (const item of sent) {
      expect(item.params).not.toHaveProperty('fallbacks')
      expect(item.params.system[0].cache_control).toEqual({ type: 'ephemeral' })
    }
    expect(new Set(sent.map((i) => i.params.system[0].text)).size).toBe(1) // one shared, cacheable system prompt
    expect(fake.calls).toHaveLength(0)
  })

  it('does nothing when disabled, without a client or right after a taxonomy edit', async () => {
    const fake = fakeEnrichClient()
    expect((await runEnrichAll(payload, null, LATER())).status).toBe('no-api-key')
    expect((await runEnrichAll(payload, fake, new Date())).status).toBe('debounced')
    expect((await runEnrichAll(payload, fake, new Date(), { force: true })).status).toBe('direct')
    await setAiSettings(payload, { enabled: false })
    expect((await runEnrichAll(payload, fake, LATER(), { force: true })).status).toBe('disabled')
    expect(fake.batches.size).toBe(0)
  })
  // "batch in flight" and "pending enrich job" need the registered task slugs: tests/int/enrich-jobs.int.test.ts (Task 10).

  it('re-enriches everything after a category intro changes', async () => {
    const { fingerprint } = await loadEnrichContext(payload)
    for (const p of plugins) {
      await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { ai: { enrichedHash: p.contentHash, promptHash: fingerprint } } })
    }
    expect((await runEnrichAll(payload, fakeEnrichClient(), LATER())).status).toBe('nothing-stale')
    const other = (await payload.find({ collection: 'categories', overrideAccess: true, where: { slug: { equals: 'other' } } })).docs[0]
    await payload.update({ collection: 'categories', id: other.id, overrideAccess: true, context: { skipRevalidate: true }, data: { intro: 'Plugins that fit nowhere else.' } })
    expect((await runEnrichAll(payload, fakeEnrichClient(), LATER())).stale).toBe(6)
  })
})

describe('runEnrichBatch', () => {
  const submit = async (fake: ReturnType<typeof fakeEnrichClient>): Promise<EnrichBatchInput> => {
    const r = await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })
    if (!r.batch) throw new Error(`expected a batch, got ${r.status}`)
    return r.batch
  }

  it('reports processing until the batch ends', async () => {
    const fake = fakeEnrichClient()
    const input = await submit(fake)
    expect(await runEnrichBatch(payload, fake, input, LATER())).toMatchObject({ status: 'processing', applied: 0 })
  })

  it('applies results in any order and routes refusals, errors, expiries and missing results to direct retries', async () => {
    const fake = fakeEnrichClient()
    const input = await submit(fake)
    const [p0, p1, p2, p3, p4, p5] = plugins
    endBatch(fake, input.batchId, [
      { custom_id: customIdFor(p4.id), result: { type: 'succeeded', message: maxTokensMessage() } },
      ok(p0.id),
      { custom_id: customIdFor(p2.id), result: { type: 'errored' } },
      { custom_id: customIdFor(p1.id), result: { type: 'succeeded', message: refusalMessage('cyber') } },
      { custom_id: customIdFor(p3.id), result: { type: 'expired' } },
      { custom_id: 'not-ours', result: { type: 'succeeded', message: okMessage(goodOutput()) } },
      ok(p0.id), // a duplicate is ignored
    ])
    const r = await runEnrichBatch(payload, fake, input, LATER())
    expect(r).toMatchObject({ status: 'done', applied: 1, failed: 1 })
    expect([...r.retryDirect].sort((a, b) => a - b)).toEqual([p1.id, p2.id, p3.id, p5.id].sort((a, b) => a - b))
    expect(r.revalidateTags).toEqual(expect.arrayContaining(['plugins', 'plugin:p0', 'category:cloud-storage']))
    expect(r.usage.input).toBe(18000) // max_tokens, success and refusal answers are all billed
    expect((await reload(p0.id)).ai).toMatchObject({ enrichedHash: 'h0', tagline: 'Store Payload uploads in Amazon S3' })
    expect((await reload(p4.id)).ai).toMatchObject({ failure: 'max_tokens' })
    expect((await reload(p1.id)).ai?.failure ?? null).toBeNull() // refusal → direct retry with fallback, not a failure yet
  })

  it('discards a result whose plugin content changed after submission', async () => {
    const fake = fakeEnrichClient()
    const input = await submit(fake)
    await payload.update({ collection: 'plugins', id: plugins[0].id, overrideAccess: true, data: { contentHash: 'h0-new' } })
    endBatch(fake, input.batchId, [ok(plugins[0].id)])
    const r = await runEnrichBatch(payload, fake, input, LATER())
    expect(r.applied).toBe(0)
    expect((await reload(plugins[0].id)).ai?.tagline ?? null).toBeNull()
  })

  it('cancels and applies nothing when AI is switched off or the prompt changed', async () => {
    const fake = fakeEnrichClient()
    const input = await submit(fake)
    await setAiSettings(payload, { enabled: false })
    expect(await runEnrichBatch(payload, fake, input, LATER())).toMatchObject({ status: 'cancelled', applied: 0 })
    expect(fake.batches.get(input.batchId)!.cancelled).toBe(true)

    await setAiSettings(payload, { enabled: true, instructions: 'New house style.' })
    const ended = fakeEnrichClient()
    const second = await submit(ended)
    await setAiSettings(payload, { instructions: 'Changed again.' })
    endBatch(ended, second.batchId, plugins.map((p) => ok(p.id)))
    expect(await runEnrichBatch(payload, ended, second, LATER())).toMatchObject({ status: 'stale-prompt', applied: 0 })
    expect((await reload(plugins[0].id)).ai?.tagline ?? null).toBeNull()
  })
})

// Controller requirements for Task 9 (cost guard, missing key warning, taxonomy snapshot).
describe('enrich-all cost guard and warnings', () => {
  it('never takes more than maxPerPass plugins in one pass, highest health first, and says so', async () => {
    const fake = fakeEnrichClient()
    const direct = await runEnrichAll(payload, fake, LATER(), { maxPerPass: 2 })
    expect(direct).toMatchObject({ status: 'direct', stale: 6, direct: [plugins[1].id, plugins[3].id] })
    expect(direct.warning).toMatch(/2 of 6/)
    const batch = await runEnrichAll(payload, fake, LATER(), { batchMin: 1, maxPerPass: 3 })
    expect(batch.batch?.items.map((i) => i.id)).toEqual([plugins[1].id, plugins[3].id, plugins[2].id])
    expect(fake.batches.get(batch.batch!.batchId)!.items).toHaveLength(3)
    expect(batch.warning).toMatch(/3 of 6/)
  })

  it('reads the per-pass maximum from ENRICH_MAX_PER_PASS, defaulting to 500', () => {
    expect(maxPerPassFromEnv({})).toBe(DEFAULT_MAX_PER_PASS)
    expect(DEFAULT_MAX_PER_PASS).toBe(500)
    expect(maxPerPassFromEnv({ ENRICH_MAX_PER_PASS: '120' })).toBe(120)
    expect(maxPerPassFromEnv({ ENRICH_MAX_PER_PASS: 'lots' })).toBe(500)
    expect(maxPerPassFromEnv({ ENRICH_MAX_PER_PASS: '0' })).toBe(500)
  })

  it('cancels an abandoned batch best-effort, never throwing (ruling F10)', async () => {
    const fake = fakeEnrichClient()
    const input = (await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })).batch!
    expect(await cancelBatchQuietly(fake, input.batchId)).toBe(true)
    expect(fake.batches.get(input.batchId)!.cancelled).toBe(true)
    expect(await cancelBatchQuietly(fake, 'msgbatch_unknown')).toBe(false)
    expect(await cancelBatchQuietly(null, input.batchId)).toBe(false)
  })

  it('without an API key it is a no-op with a clear warning, not a failure', async () => {
    const r = await runEnrichAll(payload, null, LATER())
    expect(r).toMatchObject({ status: 'no-api-key', stale: 0, direct: [], batch: null })
    expect(r.warning).toMatch(/ANTHROPIC_API_KEY/)
  })
})

describe('taxonomy snapshot per pass', () => {
  it('a tag created after submission changes neither the fingerprint nor the collected results', async () => {
    const fake = fakeEnrichClient()
    const r = await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })
    const input = r.batch!
    await payload.create({ collection: 'tags', overrideAccess: true, depth: 0, context: { skipRevalidate: true }, data: { title: 'Mid pass', slug: 'mid-pass', createdBy: 'ai' } })
    endBatch(fake, input.batchId, plugins.map((p) => ok(p.id))) // every answer proposes the same new tag
    const out = await runEnrichBatch(payload, fake, input, LATER())
    expect(out).toMatchObject({ status: 'done', applied: 6, failed: 0, retryDirect: [] })
    const created = await payload.find({ collection: 'tags', overrideAccess: true, where: { slug: { equals: 'presigned-uploads' } } })
    expect(created.totalDocs).toBe(1)
  })
})

// Fix round 1: durable in-flight marker, retry cap, failure-recording guard, empty batch.
describe('durable in-flight batch marker', () => {
  const at = (base: Date, minutes: number) => new Date(base.getTime() + minutes * 60_000)
  const jobs = async () => (await payload.find({ collection: 'payload-jobs', overrideAccess: true, limit: 0 })).totalDocs

  it('blocks a second enrich-all while the batch runs, even with no enrich-batch job queued (crash before queueing)', async () => {
    const fake = fakeEnrichClient()
    const t = LATER()
    const first = await runEnrichAll(payload, fake, t, { batchMin: 1 })
    expect(await readInflight(payload)).toEqual({ state: 'submitted', batchId: first.batch!.batchId, at: t.toISOString() })
    expect(await jobs()).toBe(0) // nothing queued the poller: only the marker guards
    expect((await runEnrichAll(payload, fake, at(t, 60), { batchMin: 1 })).status).toBe('batch-in-flight')
    expect((await runEnrichAll(payload, fake, at(t, 24 * 60), { batchMin: 1, force: true })).status).toBe('batch-in-flight')
    expect(fake.batches.size).toBe(1)
  })

  it('a create that failed after the submitting marker blocks for 1 h, then is cleared with a warning', async () => {
    const t = LATER()
    const broken = { ...fakeEnrichClient(), createBatch: async () => { throw new Error('response lost') } }
    await expect(runEnrichAll(payload, broken, t, { batchMin: 1 })).rejects.toThrow('response lost')
    expect(await readInflight(payload)).toEqual({ state: 'submitting', at: t.toISOString() })
    const fake = fakeEnrichClient()
    expect((await runEnrichAll(payload, fake, at(t, 59), { batchMin: 1 })).status).toBe('batch-in-flight')
    const r = await runEnrichAll(payload, fake, at(t, 61), { batchMin: 1 })
    expect(r.status).toBe('batch')
    expect(r.warning).toMatch(/submitting/)
    expect((await readInflight(payload))?.batchId).toBe(r.batch!.batchId)
  })

  it('a submitted marker older than 25 h is cleared with a warning', async () => {
    const fake = fakeEnrichClient()
    const t = LATER()
    await runEnrichAll(payload, fake, t, { batchMin: 1 })
    const r = await runEnrichAll(payload, fake, at(t, 25 * 60 + 1), { batchMin: 1 })
    expect(r).toMatchObject({ status: 'batch', batch: { batchId: 'msgbatch_2' } })
    expect(r.warning).toMatch(/older than 25 h/)
  })

  it('is cleared after collection, on cancel and when the batch 404s, but never for another batch', async () => {
    const fake = fakeEnrichClient()
    const input = (await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })).batch!
    expect(await runEnrichBatch(payload, fake, input, LATER())).toMatchObject({ status: 'processing' })
    expect(await readInflight(payload)).not.toBeNull()
    await clearInflight(payload, 'msgbatch_other')
    expect(await readInflight(payload)).not.toBeNull()
    endBatch(fake, input.batchId, plugins.map((p) => ok(p.id)))
    expect(await runEnrichBatch(payload, fake, input, LATER())).toMatchObject({ status: 'done', applied: 6 })
    expect(await readInflight(payload)).toBeNull()

    await setAiSettings(payload, { instructions: 'Re-run everything.' })
    const second = (await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })).batch!
    await setAiSettings(payload, { enabled: false })
    expect(await runEnrichBatch(payload, fake, second, LATER())).toMatchObject({ status: 'cancelled' })
    expect(await readInflight(payload)).toBeNull()

    await setAiSettings(payload, { enabled: true })
    const third = (await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })).batch!
    const gone = {
      ...fake,
      retrieveBatch: async () => {
        throw Anthropic.APIError.generate(404, { error: { type: 'not_found_error', message: 'x' } }, 'x', new Headers())
      },
    }
    expect(await runEnrichBatch(payload, gone, third, LATER())).toMatchObject({ status: 'not-found', applied: 0, retryDirect: [] })
    expect(await readInflight(payload)).toBeNull()
  })
})

describe('fix round 1: retry cap, failure guard, empty batch', () => {
  afterEach(() => vi.restoreAllMocks())

  it('caps direct retries at DIRECT_MAX in submission order; the rest stay stale', async () => {
    const fake = fakeEnrichClient()
    const { fingerprint } = await loadEnrichContext(payload)
    const { id: batchId } = await fake.createBatch([])
    const items = Array.from({ length: DIRECT_MAX + 10 }, (_, i) => ({ id: 1000 + i, contentHash: `x${i}` }))
    endBatch(fake, batchId, [...items].reverse().map((i) => ({ custom_id: customIdFor(i.id), result: { type: 'expired' as const } })))
    const r = await runEnrichBatch(payload, fake, { batchId, fingerprint, model: 'claude-sonnet-5-5', items }, LATER())
    expect(r.retryDirect).toEqual(items.slice(0, DIRECT_MAX).map((i) => i.id))
  })

  it('records no failure for content that changed since submission, nor when AI is off', async () => {
    const fake = fakeEnrichClient()
    const input = (await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })).batch!
    const [p0, p1] = plugins
    await payload.update({ collection: 'plugins', id: p0.id, overrideAccess: true, data: { contentHash: 'h0-new' } })
    endBatch(fake, input.batchId, [
      { custom_id: customIdFor(p0.id), result: { type: 'succeeded', message: maxTokensMessage() } },
      { custom_id: customIdFor(p1.id), result: { type: 'succeeded', message: maxTokensMessage() } },
    ])
    await runEnrichBatch(payload, fake, input, LATER())
    expect((await reload(p0.id)).ai?.failure ?? null).toBeNull()
    expect((await reload(p1.id)).ai).toMatchObject({ failure: 'max_tokens' }) // control: unchanged content records it

    const now = new Date()
    await setAiSettings(payload, { enabled: false })
    await recordEnrichmentFailure(payload, { pluginId: plugins[2].id, contentHash: 'h2', reason: 'x', key: 'k', now })
    expect((await reload(plugins[2].id)).ai?.failure ?? null).toBeNull()
  })

  it('returns nothing-stale and creates no batch when every stale plugin vanished before its request was built', async () => {
    const fake = fakeEnrichClient()
    const find = payload.find.bind(payload)
    vi.spyOn(payload, 'find').mockImplementation(((args: Parameters<Payload['find']>[0]) =>
      args.collection === 'plugins' && args.depth === 1
        ? Promise.resolve({ docs: [], totalDocs: 0 })
        : find(args)) as never)
    const r = await runEnrichAll(payload, fake, LATER(), { batchMin: 1 })
    expect(r).toMatchObject({ status: 'nothing-stale', batch: null })
    expect(fake.batches.size).toBe(0)
    expect(await readInflight(payload)).toBeNull()
  })
})
