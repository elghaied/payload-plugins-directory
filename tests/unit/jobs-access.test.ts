import { describe, expect, it } from 'vitest'
import { jobsConfig, syncTasks } from '@/sync/tasks'

const req = (user: unknown) => ({ req: { user } }) as never
const admin = { id: 1, collection: 'users' }
const maintainer = { id: 1, collection: 'maintainers' }

describe('jobs config', () => {
  it('limits queue, run and cancel to admins (v4 default allows any logged-in user)', async () => {
    for (const op of ['queue', 'run', 'cancel'] as const) {
      const fn = jobsConfig.access![op]!
      expect(await fn(req(admin))).toBe(true)
      expect(await fn(req(maintainer))).toBe(false)
      expect(await fn(req(null))).toBe(false)
    }
  })

  it('shows payload-jobs read-only to admins in the admin panel', () => {
    const deny = () => false
    const col = jobsConfig.jobsCollectionOverrides!({
      defaultJobsCollection: { slug: 'payload-jobs', fields: [], admin: { hidden: true }, access: { create: deny, read: deny, update: deny, delete: deny } },
    } as never)
    const read = col.access!.read as (args: unknown) => unknown
    const update = col.access!.update as (args: unknown) => unknown
    expect(col.admin?.hidden).toBe(false)
    expect(read(req(admin))).toBe(true)
    expect(read(req(maintainer))).toBe(false)
    expect(update(req(admin))).toBe(false)
  })

  it('registers the five sync tasks with their schedules', () => {
    expect(syncTasks.map((t) => t.slug)).toEqual(['discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate'])
    const schedules = Object.fromEntries(syncTasks.filter((t) => t.schedule).map((t) => [t.slug, t.schedule!.map((s) => `${s.cron} @${s.queue}`)]))
    expect(schedules).toEqual({ discover: ['0 */6 * * * @default'], 'npm-stats': ['0 1 * * * @default'], snapshot: ['30 0 * * * @default'] })
  })
})
