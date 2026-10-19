import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { eq } from '@payloadcms/db-postgres/drizzle'
import { jobStatus } from '@/db/jobStatus'
import { setSyncDeps } from '@/sync/deps'
import { DISCOVER_GUARD_KEY } from '@/sync/jobStatus'
import { fakeFetch, type FakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { DOWNLOADS, ghRepo, json, npmRoutes, pkg, RAW, raw, repoById, repoByName, searchPage, searchResult } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')
const SECRET = 's3cret-s3cret-s3cret-s3cret-s3cret' // at least MIN_SECRET_LENGTH characters
const env = { internalWebUrl: 'http://web.test', revalidateSecret: SECRET }
const REVALIDATE_URL = 'http://web.test/api/revalidate'

const useFetch = (routes: Record<string, FakeRoute>, now: () => Date = () => NOW): FakeFetch => {
  const f = fakeFetch(routes, { notFoundPrefixes: [RAW] })
  setSyncDeps({ fetch: f, now, env })
  return f
}
/** Runs a queue with Payload's error logging off: failing jobs are expected in these tests. */
const runQueue = (queue: 'default' | 'sync') => payload.jobs.run({ queue, overrideAccess: true, silent: true })
const status = async (key: string) => (await payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, key)))[0]
const jobsOf = async (task: string) =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: task } } })).docs

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterEach(() => setSyncDeps(null))
afterAll(async () => resetDatabase(payload))

describe('sync jobs through payload.jobs', () => {
  it('runs a revalidate job against INTERNAL_WEB_URL and records success', async () => {
    const f = useFetch({ [REVALIDATE_URL]: { json: { revalidated: ['plugins', 'plugin:a'] } } })
    await payload.jobs.queue({ task: 'revalidate', input: { tags: ['plugins', 'plugin:a'] }, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(f.calls).toHaveLength(1)
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ tags: ['plugins', 'plugin:a'] })
    expect(new Headers(f.calls[0].init?.headers).get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(await status('revalidate')).toMatchObject({ lastSuccessAt: NOW, details: { status: 'ok', count: 2 } })
  })

  it('a snapshot job queues a revalidate of the trending and stats tags after writing', async () => {
    useFetch({})
    const repo = await createRepo(payload, { fullName: 'acme/seo', githubId: 7 })
    await createPlugin(payload, repo.id, { slug: 's1' })
    await payload.jobs.queue({ task: 'snapshot', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true, silent: true, limit: 1 })
    expect(await status('snapshot')).toMatchObject({ lastSuccessAt: NOW })
    const revalidates = await jobsOf('revalidate')
    expect(revalidates).toHaveLength(1)
    expect(revalidates[0].input).toEqual({ tags: ['trending', 'stats'] })
  })

  it('records a failed revalidation and leaves the job for a retry', async () => {
    useFetch({ [REVALIDATE_URL]: { status: 500 } })
    await payload.jobs.queue({ task: 'revalidate', input: { tags: ['plugins'] }, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(await status('revalidate')).toMatchObject({ lastFailureAt: NOW, lastError: expect.stringContaining('HTTP 500') })
    const [job] = await jobsOf('revalidate')
    expect(job.completedAt ?? null).toBeNull()
    expect(job.hasError ?? false).toBe(false) // retries remain
    expect(job.totalTried).toBe(1)
  })

  it('treats a request timeout as transient: the job is left for a retry', async () => {
    useFetch({ [REVALIDATE_URL]: () => { throw new DOMException('The operation was aborted due to timeout', 'TimeoutError') } })
    await payload.jobs.queue({ task: 'revalidate', input: { tags: ['plugins'] }, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(await status('revalidate')).toMatchObject({ lastFailureAt: NOW, lastError: expect.stringContaining('timeout') })
    const [job] = await jobsOf('revalidate')
    expect(job.hasError ?? false).toBe(false) // retries remain
    expect(job.totalTried).toBe(1)
  })

  it('a sync-repository job queues npm-stats for new plugins and one revalidate', async () => {
    useFetch({
      [repoById(7)]: json(ghRepo(7, 'acme/payload-seo')),
      [raw('acme/payload-seo', 'package.json')]: pkg({ name: 'payload-seo', peerDependencies: { payload: '^3.0.0' } }),
    })
    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, queue: 'sync', overrideAccess: true })
    await runQueue('sync')
    expect((await jobsOf('npm-stats')).map((j) => j.input)).toEqual([{ slugs: ['7-root'] }])
    expect((await jobsOf('revalidate')).map((j) => j.input)).toEqual([{ tags: ['plugins', 'plugin:7-root'] }])
    expect(await status('sync-repository')).toMatchObject({ details: { status: 'synced', created: 1 } })
  })

  it('re-queues a rate-limited sync-repository job at the reset time without using a retry', async () => {
    const reset = 1792411200
    useFetch({ [repoById(7)]: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) } } })
    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, queue: 'sync', overrideAccess: true })
    await runQueue('sync')
    const jobs = await jobsOf('sync-repository')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].waitUntil).toBe(new Date(reset * 1000).toISOString())
    expect(jobs[0].completedAt ?? null).toBeNull()
    expect(jobs[0].totalTried ?? 0).toBe(0) // a fresh job: the retry budget is untouched
    expect(jobs[0].input).toMatchObject({ fullName: 'acme/payload-seo', githubId: 7, source: 'topic' })
    expect(await status('sync-repository')).toMatchObject({ details: { status: 'rate-limited' } })
    expect((await status('sync-repository')).lastFailureAt ?? null).toBeNull()
  })

  it('re-queues a rate-limited npm-stats job with the slugs not yet fetched', async () => {
    const repo = await createRepo(payload, { fullName: 'acme/seo', githubId: 7 })
    await createPlugin(payload, repo.id, { slug: 's1', packageName: 'payload-seo' })
    useFetch({ ...npmRoutes('payload-seo'), [`${DOWNLOADS}/last-week/payload-seo`]: { status: 429 } })
    await payload.jobs.queue({ task: 'npm-stats', input: {}, queue: 'default', overrideAccess: true })
    await runQueue('default')
    const jobs = await jobsOf('npm-stats')
    expect(jobs).toHaveLength(1)
    expect(jobs[0].input).toEqual({ slugs: ['s1'] })
    expect(jobs[0].waitUntil).toBe(new Date(NOW.getTime() + 60_000).toISOString())
    expect(await status('npm-stats')).toMatchObject({ details: { status: 'rate-limited' } })
  })

  it('keeps the last discover guard warning when a later discover run fails', async () => {
    useFetch({ [searchPage(1)]: searchResult([], { incomplete_results: true }) })
    await payload.jobs.queue({ task: 'discover', input: {}, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(await status('discover')).toMatchObject({ details: { status: 'guarded' } })
    expect(await status(DISCOVER_GUARD_KEY)).toMatchObject({ lastSuccessAt: NOW, details: { warning: expect.stringMatching(/incomplete/) } })

    useFetch({ [searchPage(1)]: { status: 500 } })
    await payload.jobs.queue({ task: 'discover', input: {}, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(await status('discover')).toMatchObject({ lastFailureAt: NOW, lastError: expect.stringContaining('HTTP 500') })
    expect(await status(DISCOVER_GUARD_KEY)).toMatchObject({ lastSuccessAt: NOW, details: { warning: expect.stringMatching(/incomplete/) } })
  })

  it('keys sync-repository by lower-cased full name across sources, and accepts a bare { fullName } input', async () => {
    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'Acme/Payload-SEO', source: 'submission' }, queue: 'sync', overrideAccess: true })
    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, queue: 'sync', overrideAccess: true })
    let jobs = await jobsOf('sync-repository')
    expect(jobs).toHaveLength(1) // the newer job superseded the pending one
    expect(jobs[0]).toMatchObject({ concurrencyKey: 'sync-repository:acme/payload-seo', input: { githubId: 7, source: 'topic' } })

    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'acme/other' }, queue: 'sync', overrideAccess: true })
    jobs = await jobsOf('sync-repository')
    expect(jobs.map((j) => j.concurrencyKey).sort()).toEqual(['sync-repository:acme/other', 'sync-repository:acme/payload-seo'])
  })
  it('fails a revalidate job without retries when REVALIDATE_SECRET is missing or too short', async () => {
    for (const revalidateSecret of [undefined, 'short']) {
      const f = fakeFetch({})
      setSyncDeps({ fetch: f, now: () => NOW, env: { internalWebUrl: 'http://web.test', revalidateSecret } })
      await payload.jobs.queue({ task: 'revalidate', input: { tags: ['plugins'] }, queue: 'default', overrideAccess: true })
      await runQueue('default')
      expect(f.calls).toHaveLength(0)
      const [job] = await jobsOf('revalidate')
      expect(job).toMatchObject({ hasError: true, error: { cancelled: true } })
      expect(job.completedAt ?? null).toBeNull()
      expect(await status('revalidate')).toMatchObject({ lastFailureAt: NOW, lastError: expect.stringContaining('REVALIDATE_SECRET') })
      // a later run does not pick the failed job up again
      await runQueue('default')
      expect(f.calls).toHaveLength(0)
      await payload.delete({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
    }
  })

  it('runs a bare { fullName } sync-repository input (Phase 4 submissions) through the handler', async () => {
    useFetch({
      [repoByName('acme/payload-seo')]: json(ghRepo(7, 'acme/payload-seo')),
      [raw('acme/payload-seo', 'package.json')]: pkg({ name: 'payload-seo', peerDependencies: { payload: '^3.0.0' } }),
    })
    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'acme/payload-seo' }, queue: 'sync', overrideAccess: true })
    await runQueue('sync')
    expect(await status('sync-repository')).toMatchObject({ details: { status: 'synced', created: 1 } })
    const [plugin] = (await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '7-root' } } })).docs
    expect(plugin).toMatchObject({ source: 'topic', visibility: 'listed' })
  })

  it('stamps the guard row and the discover row with one timestamp per run (clock advancing on every call)', async () => {
    let tick = 0
    const clock = () => new Date(NOW.getTime() + tick++ * 1000)
    const guardCurrent = async () => (await status(DISCOVER_GUARD_KEY)).lastSuccessAt!.getTime() >= (await status('discover')).lastSuccessAt!.getTime()

    useFetch({ [searchPage(1)]: searchResult([], { incomplete_results: true }) }, clock)
    await payload.jobs.queue({ task: 'discover', input: {}, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(await status('discover')).toMatchObject({ details: { status: 'guarded' } })
    expect(await guardCurrent()).toBe(true)

    useFetch({ [searchPage(1)]: searchResult([]) }, clock)
    await payload.jobs.queue({ task: 'discover', input: {}, queue: 'default', overrideAccess: true })
    await runQueue('default')
    expect(await status('discover')).toMatchObject({ details: { status: 'ok' } })
    expect(await guardCurrent()).toBe(false)
  })
})
