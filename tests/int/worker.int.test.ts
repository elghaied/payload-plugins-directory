import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { setSyncDeps } from '@/sync/deps'
import { runWorkerTick } from '@/sync/worker'
import { fakeFetch } from '../helpers/fakeFetch'
import { getTestPayload, resetDatabase } from './helpers/payload'

const SECRET = 's3cret-s3cret-s3cret-s3cret-s3cret' // at least MIN_SECRET_LENGTH characters
let payload: Payload

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterEach(() => setSyncDeps(null))
afterAll(async () => resetDatabase(payload))

describe('runWorkerTick', () => {
  it('queues each schedule once and drains runnable jobs', async () => {
    const f = fakeFetch({ 'http://web.test/api/revalidate': { json: { revalidated: ['plugins'] } } })
    setSyncDeps({ fetch: f, env: { internalWebUrl: 'http://web.test', revalidateSecret: SECRET } })
    await payload.jobs.queue({ task: 'revalidate', input: { tags: ['plugins'] }, queue: 'default', overrideAccess: true })

    expect(await runWorkerTick(payload, { budgetMs: 10_000 })).toEqual({ scheduled: 4, ran: { default: 1, sync: 0, enrich: 0 } })
    expect(f.calls).toHaveLength(1)

    const pending = await payload.find({ collection: 'payload-jobs', overrideAccess: true, sort: 'taskSlug' })
    // task_slug is a Postgres enum: SQL sorts by declaration order (new slugs last), so sort the names here.
    expect(pending.docs.map((j) => j.taskSlug).sort()).toEqual(['discover', 'enrich-all', 'npm-stats', 'snapshot'])
    expect(pending.docs.every((j) => Boolean(j.waitUntil) && Date.parse(j.waitUntil!) > Date.now())).toBe(true)

    expect(await runWorkerTick(payload, { budgetMs: 10_000 })).toEqual({ scheduled: 0, ran: { default: 0, sync: 0, enrich: 0 } })
  })

  it('starts nothing once asked to stop', async () => {
    const f = fakeFetch({ 'http://web.test/api/revalidate': { json: { revalidated: ['plugins'] } } })
    setSyncDeps({ fetch: f, env: { internalWebUrl: 'http://web.test', revalidateSecret: SECRET } })
    await payload.jobs.queue({ task: 'revalidate', input: { tags: ['plugins'] }, queue: 'default', overrideAccess: true })

    expect(await runWorkerTick(payload, { budgetMs: 10_000, shouldStop: () => true })).toEqual({
      scheduled: 0,
      ran: { default: 0, sync: 0, enrich: 0 },
    })
    expect(f.calls).toHaveLength(0)
  })
})
