import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { createPayloadRequest, type Payload } from 'payload'
import { runJobEndpoint } from '@/endpoints/runJob'
import { MANUAL_JOBS } from '@/sync/manualJobs'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const admin = { id: 1, collection: 'users' } as never
const maintainer = { id: 1, collection: 'maintainers' } as never

const jobsOf = async (taskSlug: string) =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: taskSlug } }, limit: 0, pagination: false })).docs
const call = async (user: unknown, task: string) => {
  const req = await createPayloadRequest({ payload, user: user as never })
  req.routeParams = { task }
  const res = await runJobEndpoint.handler(req)
  return { status: res.status, body: (await res.json()) as { status?: string; error?: string } }
}

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('POST /api/run-job/:task', () => {
  it('queues every dashboard job for an admin, with its scheduled (empty) input on the default queue', async () => {
    for (const { task } of MANUAL_JOBS) {
      expect(await call(admin, task)).toEqual({ status: 200, body: { status: 'queued' } })
      const jobs = await jobsOf(task)
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({ queue: 'default', input: {} })
    }
  })

  it('does not queue a second run while one is due, but ignores a scheduled run hours away', async () => {
    await payload.jobs.queue({ task: 'discover', input: {}, queue: 'default', waitUntil: new Date(Date.now() + 3 * 3_600_000), meta: { scheduled: true }, overrideAccess: true })
    expect((await call(admin, 'discover')).body).toEqual({ status: 'queued' })
    expect((await call(admin, 'discover')).body).toEqual({ status: 'already-pending' })
    expect(await jobsOf('discover')).toHaveLength(2)
  })

  it('refuses non-admins and anonymous callers, and per-item or unknown tasks', async () => {
    expect((await call(maintainer, 'discover')).status).toBe(403)
    expect((await call(null, 'discover')).status).toBe(403)
    expect((await call(admin, 'sync-repository')).status).toBe(404)
    expect((await call(admin, 'enrich')).status).toBe(404)
    expect((await call(admin, 'nope')).status).toBe(404)
    expect(await jobsOf('discover')).toHaveLength(0)
  })
})
