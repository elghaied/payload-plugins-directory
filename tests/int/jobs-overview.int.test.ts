import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import { getJobsOverview } from '@/sync/jobsOverview'
import { startedKey, track } from '@/sync/taskKit'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const statusRow = async (key: string) => (await payload.db.drizzle.select().from(jobStatus)).find((r) => r.key === key)

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('track() run records', () => {
  it('records when a run started and, on success, its duration next to the output', async () => {
    const at = new Date('2026-10-22T10:00:00Z')
    await track(payload, 'snapshot', at, async () => {
      expect((await statusRow(startedKey('snapshot')))?.lastSuccessAt).toEqual(at) // visible while the run is going
      return { status: 'ok', repositories: 3 }
    })
    const row = await statusRow('snapshot')
    expect(row?.details).toMatchObject({ status: 'ok', repositories: 3 })
    expect(typeof row?.details?.durationMs).toBe('number')
  })
})

describe('getJobsOverview', () => {
  it('reads running (live lease), waiting and pre-scheduled jobs from the queue, and the schedules from the config', async () => {
    const now = new Date()
    const running = await payload.jobs.queue({ task: 'npm-stats', input: {}, queue: 'default', overrideAccess: true })
    await payload.update({ collection: 'payload-jobs', id: running.id, overrideAccess: true, data: { processingUntil: new Date(now.getTime() + 600_000).toISOString() } as never })
    await payload.jobs.queue({ task: 'revalidate', input: { tags: ['x'] }, queue: 'default', overrideAccess: true })
    await payload.jobs.queue({ task: 'discover', input: {}, queue: 'default', waitUntil: new Date(now.getTime() + 3_600_000), overrideAccess: true })

    const o = await getJobsOverview(payload, now)
    expect(o.counts).toMatchObject({ running: 1, waiting: 1, scheduled: 1 })
    expect(o.running.map((r) => r.task)).toEqual(['npm-stats'])
    expect(o.upcoming).toEqual([expect.objectContaining({ task: 'discover', kind: 'scheduled', manual: true })])
    const t = Object.fromEntries(o.tasks.map((x) => [x.slug, x]))
    expect(t.discover.schedule).toBe('every 6 h at :00')
    expect(t['discover-templates'].schedule).toBe('every 6 h at :15')
    expect(t['enrich-all'].schedule).toBe('hourly at :20')
    expect(t['render-readmes'].schedule).toBe('daily 02:15 UTC')
    expect(t.revalidate).toMatchObject({ schedule: null, waiting: 1 })
  })
})
