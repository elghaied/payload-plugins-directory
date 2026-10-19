import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import Anthropic from '@anthropic-ai/sdk'
import { eq } from '@payloadcms/db-postgres/drizzle'
import { jobStatus } from '@/db/jobStatus'
import { BATCH_POLL_MS, readInflight, runEnrichAll } from '@/enrich/batch'
import { failureKey, loadEnrichContext } from '@/enrich/context'
import { queueEnrichForChanged } from '@/enrich/queue'
import { NO_KEY_POLL_MS } from '@/enrich/tasks'
import { setSyncDeps } from '@/sync/deps'
import { fakeEnrichClient, okMessage, type FakeEnrichClient } from '../helpers/fakeEnrichClient'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { ghRepo, json, pkg, RAW, raw, repoById, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy, goodOutput, setAiSettings } from './helpers/taxonomy'

let payload: Payload
const LATER = new Date(Date.now() + 2 * 3_600_000) // past the taxonomy-edit debounce
const env = { internalWebUrl: 'http://web.test', revalidateSecret: 's3cret' }
const status = async (key: string) => (await payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, key)))[0]
const jobsOf = async (task: string) =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, sort: 'createdAt', where: { taskSlug: { equals: task } } })).docs
const setDeps = (enrichClient: FakeEnrichClient | null, routes: Record<string, FakeRoute> = {}) =>
  setSyncDeps({ fetch: fakeFetch(routes, { notFoundPrefixes: [RAW] }), now: () => LATER, env, enrichClient })

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await createTestTaxonomy(payload)
})
afterEach(() => setSyncDeps(null))
afterAll(async () => resetDatabase(payload))

describe('enrich jobs through payload.jobs', () => {
  it('an enrich job enriches the plugin, queues one revalidate and records job status', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1', readme: '# P1' })
    setDeps(fakeEnrichClient(() => okMessage(goodOutput())))
    await payload.jobs.queue({ task: 'enrich', input: { pluginId: p.id }, queue: 'enrich', overrideAccess: true })
    await payload.jobs.run({ queue: 'enrich', overrideAccess: true })
    expect((await payload.findByID({ collection: 'plugins', id: p.id, overrideAccess: true })).ai?.enrichedHash).toBe('h1')
    expect((await jobsOf('revalidate')).map((j) => j.input)).toEqual([{ tags: ['plugins', 'plugin:p1', 'category:cloud-storage'] }])
    expect(await status('enrich')).toMatchObject({
      lastSuccessAt: LATER, details: { status: 'applied', inputTokens: 6000, outputTokens: 800, cacheReadTokens: 2500 },
    })
  })

  it('completes without an API key and changes nothing', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    setDeps(null)
    await payload.jobs.queue({ task: 'enrich', input: { pluginId: p.id }, queue: 'enrich', overrideAccess: true })
    await payload.jobs.run({ queue: 'enrich', overrideAccess: true })
    expect(await status('enrich')).toMatchObject({ details: { status: 'no-api-key' } })
    expect(await jobsOf('revalidate')).toEqual([])
  })

  it('cancels an enrich job on a permanent Anthropic error instead of retrying it', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    setDeps(fakeEnrichClient(() => {
      throw Anthropic.APIError.generate(401, { error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers())
    }))
    await payload.jobs.queue({ task: 'enrich', input: { pluginId: p.id }, queue: 'enrich', overrideAccess: true })
    await payload.jobs.run({ queue: 'enrich', overrideAccess: true })
    const [job] = await jobsOf('enrich')
    expect(job).toMatchObject({ hasError: true, error: { cancelled: true } })
    expect(await status('enrich')).toMatchObject({ lastFailureAt: LATER })
  })

  it('sync-repository re-enriches previously enriched plugins whose content changed, unless AI is off', async () => {
    const sync = async (pushedAt: string, readme: string) => {
      setDeps(fakeEnrichClient(), {
        [repoById(7)]: json(ghRepo(7, 'acme/payload-seo', { pushed_at: pushedAt })),
        [raw('acme/payload-seo', 'package.json')]: pkg({ name: 'payload-seo', peerDependencies: { payload: '^3.0.0' } }),
        [raw('acme/payload-seo', 'README.md')]: text(readme),
      })
      await payload.jobs.queue({
        task: 'sync-repository', input: { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, queue: 'sync', overrideAccess: true,
      })
      await payload.jobs.run({ queue: 'sync', overrideAccess: true })
    }

    await sync('2026-10-18T09:00:00Z', '# v1')
    expect(await jobsOf('enrich')).toEqual([]) // never enriched: left to enrich-all, which batches the first pass
    const doc = (await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '7-root' } } })).docs[0]
    await payload.update({
      collection: 'plugins', id: doc.id, overrideAccess: true,
      data: { ai: { enrichedAt: LATER.toISOString(), enrichedHash: doc.contentHash } },
    })

    await sync('2026-10-19T08:00:00Z', '# v2')
    expect((await jobsOf('enrich')).map((j) => j.input)).toEqual([{ pluginId: doc.id }])
    expect(await status('sync-repository')).toMatchObject({ details: { enrichQueued: 1 } })

    await payload.delete({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'enrich' } } })
    await setAiSettings(payload, { enabled: false })
    await sync('2026-10-19T09:00:00Z', '# v3')
    expect(await jobsOf('enrich')).toEqual([])
  })

  it('an enrich-all job queues direct jobs and skips plugins that already have one', async () => {
    const repo = await createRepo(payload)
    const p1 = await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1', healthScore: 90 })
    const p2 = await createPlugin(payload, repo.id, { slug: 'p2', contentHash: 'h2', healthScore: 10 })
    await payload.jobs.queue({ task: 'enrich', input: { pluginId: p1.id }, queue: 'enrich', overrideAccess: true })
    setDeps(fakeEnrichClient())
    await payload.jobs.queue({ task: 'enrich-all', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    expect((await jobsOf('enrich')).map((j) => j.input)).toEqual([{ pluginId: p1.id }, { pluginId: p2.id }])
    expect(await status('enrich-all')).toMatchObject({ details: { status: 'direct', stale: 1, queued: 1 } })
  })

  it('an enrich-all job without an API key succeeds with the warning in its status', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    setDeps(null)
    await payload.jobs.queue({ task: 'enrich-all', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    const row = await status('enrich-all')
    expect(row).toMatchObject({ lastSuccessAt: LATER, details: { status: 'no-api-key', warning: expect.stringMatching(/ANTHROPIC_API_KEY/) } })
    expect(row.lastFailureAt).toBeNull()
    expect(await jobsOf('enrich')).toEqual([])
  })

  it('an enrich-all job that submits a batch queues its enrich-batch poller in the same run', async () => {
    const repo = await createRepo(payload)
    for (let i = 0; i < 20; i++) await createPlugin(payload, repo.id, { slug: `p${i}`, contentHash: `h${i}` })
    const fake = fakeEnrichClient()
    setDeps(fake)
    await payload.jobs.queue({ task: 'enrich-all', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    expect(fake.batches.size).toBe(1)
    const [poller] = await jobsOf('enrich-batch')
    expect(poller.input).toMatchObject({ batchId: 'msgbatch_1' })
    expect(poller.waitUntil).toBe(new Date(LATER.getTime() + BATCH_POLL_MS).toISOString())
    expect(await status('enrich-all')).toMatchObject({ details: { status: 'batch', stale: 20, queued: 0, batchId: 'msgbatch_1' } })
  })

  it('enrich-all waits while a batch is in flight; enrich-batch re-queues itself until the batch ends', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    const fake = fakeEnrichClient()
    const { batch } = await runEnrichAll(payload, fake, LATER, { batchMin: 1 })
    setDeps(fake)
    await payload.jobs.queue({ task: 'enrich-batch', input: batch!, queue: 'default', overrideAccess: true })
    expect((await runEnrichAll(payload, fake, LATER)).status).toBe('batch-in-flight')

    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    const pending = await jobsOf('enrich-batch')
    expect(pending).toHaveLength(1)
    expect(pending[0].input).toEqual(batch)
    expect(pending[0].waitUntil).toBe(new Date(LATER.getTime() + BATCH_POLL_MS).toISOString())
    expect(await status('enrich-batch')).toMatchObject({ details: { status: 'processing' } })
  })

  it('an enrich-batch job that exhausts its retries cancels the batch and clears the in-flight marker (ruling F10)', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    const fake = fakeEnrichClient()
    const { batch } = await runEnrichAll(payload, fake, LATER, { batchMin: 1 })
    setDeps({ ...fake, retrieveBatch: async () => { throw new Error('upstream flaky') } })
    await payload.jobs.queue({ task: 'enrich-batch', input: batch!, queue: 'default', overrideAccess: true })

    // 1 run + 5 retries; the backoff waitUntil is cleared between runs so the test does not wait.
    for (let attempt = 1; attempt <= 6; attempt++) {
      await payload.update({
        collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'enrich-batch' } }, data: { waitUntil: null },
      })
      await payload.jobs.run({ queue: 'default', overrideAccess: true })
      const [job] = await jobsOf('enrich-batch')
      const done = attempt === 6
      expect(job).toMatchObject({ totalTried: attempt, hasError: done })
      expect(fake.batches.get(batch!.batchId)!.cancelled).toBe(done)
      expect(await readInflight(payload)).toEqual(done ? null : expect.objectContaining({ batchId: batch!.batchId }))
    }
  })

  it('an enrich-batch job cancelled by a permanent error also cancels the batch and clears the marker', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    const fake = fakeEnrichClient()
    const { batch } = await runEnrichAll(payload, fake, LATER, { batchMin: 1 })
    setDeps({
      ...fake,
      retrieveBatch: async () => {
        throw Anthropic.APIError.generate(401, { error: { type: 'authentication_error', message: 'bad key' } }, 'bad key', new Headers())
      },
    })
    await payload.jobs.queue({ task: 'enrich-batch', input: batch!, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    const [job] = await jobsOf('enrich-batch')
    expect(job).toMatchObject({ hasError: true, error: { cancelled: true } })
    expect(fake.batches.get(batch!.batchId)!.cancelled).toBe(true)
    expect(await readInflight(payload)).toBeNull()
  })

  it('sync does not re-queue a previously enriched plugin whose current input already failed; new content is queued', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    const { fingerprint } = await loadEnrichContext(payload)
    await payload.update({
      collection: 'plugins', id: p.id, overrideAccess: true,
      data: { ai: { enrichedAt: LATER.toISOString(), enrichedHash: 'h0', failedKey: failureKey('h1', fingerprint) } },
    })
    expect(await queueEnrichForChanged(payload, [p.id])).toBe(0)
    expect(await jobsOf('enrich')).toEqual([])

    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { contentHash: 'h2' } })
    expect(await queueEnrichForChanged(payload, [p.id])).toBe(1)
    expect((await jobsOf('enrich')).map((j) => j.input)).toEqual([{ pluginId: p.id }])
  })

  it('enrich-batch without an API key polls again in an hour instead of dropping the paid batch', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    const fake = fakeEnrichClient()
    const { batch } = await runEnrichAll(payload, fake, LATER, { batchMin: 1 })
    setDeps(null)
    await payload.jobs.queue({ task: 'enrich-batch', input: batch!, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    const pending = await jobsOf('enrich-batch')
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ input: batch, totalTried: 0, waitUntil: new Date(LATER.getTime() + NO_KEY_POLL_MS).toISOString() })
    expect(NO_KEY_POLL_MS).toBe(3_600_000)
    expect(await status('enrich-batch')).toMatchObject({ details: { status: 'no-api-key' } })
    expect(await readInflight(payload)).toMatchObject({ batchId: batch!.batchId })
  })

  it('an Anthropic rate limit with retry-after re-queues enrich at that time without using a retry', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    setDeps(fakeEnrichClient(() => {
      throw Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers({ 'retry-after': '30' }))
    }))
    await payload.jobs.queue({ task: 'enrich', input: { pluginId: p.id }, queue: 'enrich', overrideAccess: true })
    await payload.jobs.run({ queue: 'enrich', overrideAccess: true })
    const jobs = await jobsOf('enrich')
    expect(jobs).toHaveLength(1)
    expect(jobs[0]).toMatchObject({ input: { pluginId: p.id }, totalTried: 0, hasError: false })
    expect(jobs[0].waitUntil).toBe(new Date(LATER.getTime() + 30_000).toISOString())
    expect(await status('enrich')).toMatchObject({ details: { status: 'rate-limited' } })
  })

  it('an overloaded API with retry-after-ms re-queues enrich-batch at that time without using a retry', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    const fake = fakeEnrichClient()
    const { batch } = await runEnrichAll(payload, fake, LATER, { batchMin: 1 })
    setDeps({
      ...fake,
      retrieveBatch: async () => {
        throw Anthropic.APIError.generate(529, { error: { type: 'overloaded_error', message: 'busy' } }, 'busy', new Headers({ 'retry-after-ms': '90000' }))
      },
    })
    await payload.jobs.queue({ task: 'enrich-batch', input: batch!, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    const pending = await jobsOf('enrich-batch')
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ input: batch, totalTried: 0, waitUntil: new Date(LATER.getTime() + 90_000).toISOString() })
    expect(fake.batches.get(batch!.batchId)!.cancelled).toBe(false)
    expect(await readInflight(payload)).toMatchObject({ batchId: batch!.batchId })
  })
})
