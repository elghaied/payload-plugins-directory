import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import {
  DISCOVER_GUARD_KEY,
  getJobHealth,
  recordGitHubQuota,
  recordJobFailure,
  recordJobSuccess,
} from '@/sync/jobStatus'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)
const guard = { warning: 'Discovery saw 1 of 4 known repositories; no repository was counted as missed or trashed.', known: 4, knownSeen: 1 }

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('getJobHealth', () => {
  it('summarises job_status, failed jobs and pending jobs per queue', async () => {
    await recordJobSuccess(payload, 'discover', { status: 'guarded' }, hoursAgo(5))
    await recordJobSuccess(payload, DISCOVER_GUARD_KEY, guard, hoursAgo(5))
    await recordJobSuccess(payload, 'npm-stats', { status: 'ok' }, hoursAgo(60))
    await recordJobFailure(payload, 'revalidate', new Error('HTTP 500'), hoursAgo(1))
    await recordGitHubQuota(payload, { remaining: 4000, limit: 5000, resetAt: now.toISOString() }, now)
    await payload.jobs.queue({ task: 'snapshot', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.queue({ task: 'sync-repository', input: { fullName: 'acme/a' }, queue: 'sync', overrideAccess: true })
    await payload.create({
      collection: 'payload-jobs',
      overrideAccess: true,
      data: { taskSlug: 'revalidate', queue: 'default', input: { tags: ['plugins'] }, hasError: true, totalTried: 5 } as never,
    })
    // a job cancelled as non-retryable is a failed job too
    await payload.create({
      collection: 'payload-jobs',
      overrideAccess: true,
      data: { taskSlug: 'sync-repository', queue: 'sync', input: {}, hasError: true, error: { cancelled: true, message: 'bad input' }, totalTried: 1 } as never,
    })

    const health = await getJobHealth(payload, now)
    const task = (slug: string) => health.tasks.find((t) => t.slug === slug)
    expect(health.tasks.map((t) => t.slug)).toEqual(['discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate', 'enrich-all', 'enrich-batch', 'enrich', 'discover-templates', 'sync-template', 'enrich-template'])
    expect(task('discover-templates')).toMatchObject({ lastSuccessAt: null, overdue: true })
    expect(task('sync-template')?.overdue).toBe(false)
    expect(task('discover')).toMatchObject({ lastSuccessAt: hoursAgo(5).toISOString(), overdue: false, failing: false })
    expect(task('npm-stats')?.overdue).toBe(true)
    expect(task('snapshot')).toMatchObject({ lastSuccessAt: null, overdue: true })
    expect(task('revalidate')).toMatchObject({ lastFailureAt: hoursAgo(1).toISOString(), lastError: 'HTTP 500', overdue: false, failing: true })
    expect(health.discoverWarning).toBe('Topic-search repositories seen 1 of 4; no repository was counted as missed or trashed.')
    expect(health.githubQuota).toMatchObject({ remaining: 4000, limit: 5000 })
    expect(health.failedJobs7d).toBe(2)
    expect(health.pending).toEqual({ default: 1, sync: 1, enrich: 0 })
  })

  it('hides the discover warning once a later discover run succeeded, and a recovered task is not failing', async () => {
    await recordJobSuccess(payload, DISCOVER_GUARD_KEY, guard, hoursAgo(10))
    await recordJobSuccess(payload, 'discover', { status: 'ok' }, hoursAgo(4))
    await recordJobFailure(payload, 'snapshot', new Error('boom'), hoursAgo(3))
    await recordJobSuccess(payload, 'snapshot', { status: 'ok' }, hoursAgo(2))
    const health = await getJobHealth(payload, now)
    expect(health.discoverWarning).toBeNull()
    expect(health.tasks.find((t) => t.slug === 'snapshot')?.failing).toBe(false)
  })

  it('redacts token-like strings and truncates stored errors', async () => {
    await recordJobFailure(payload, 'revalidate', new Error(`bad Bearer abc.def ghp_${'a'.repeat(36)} ${'x'.repeat(500)}`), hoursAgo(1))
    const err = (await getJobHealth(payload, now)).tasks.find((t) => t.slug === 'revalidate')?.lastError ?? ''
    expect(err).not.toContain('ghp_')
    expect(err).not.toContain('abc.def')
    expect(err.length).toBeLessThanOrEqual(201)
  })
})
