import { describe, expect, it } from 'vitest'
import { buildJobsOverview, describeCron, summarizeOutput, type ActiveJob, type StatusRow } from '@/sync/jobsOverview'

const NOW = new Date('2026-10-22T12:00:00Z')
const at = (min: number) => new Date(NOW.getTime() + min * 60_000)
const row = (key: string, over: Partial<StatusRow> = {}): StatusRow => ({ key, lastSuccessAt: null, lastFailureAt: null, lastError: null, details: null, updatedAt: null, ...over })
let id = 0
const job = (taskSlug: string, over: Partial<ActiveJob> = {}): ActiveJob => ({
  id: ++id, taskSlug, queue: 'default', createdAt: at(-1).toISOString(), waitUntil: null, processingUntil: null, input: {}, totalTried: 0, ...over,
})
const build = (rows: StatusRow[], active: ActiveJob[], extra: Partial<Parameters<typeof buildJobsOverview>[0]> = {}) =>
  buildJobsOverview({ now: NOW, rows, active, failed: [], failed7d: 0, schedules: { discover: 'every 6 h at :00' }, ...extra })

describe('describeCron', () => {
  it('reads the schedules this project uses', () => {
    expect(describeCron('0 */6 * * *')).toBe('every 6 h at :00')
    expect(describeCron('15 */6 * * *')).toBe('every 6 h at :15')
    expect(describeCron('20 * * * *')).toBe('hourly at :20')
    expect(describeCron('30 0 * * *')).toBe('daily 00:30 UTC')
    expect(describeCron('0 1 * * 1')).toBeNull()
    expect(describeCron(undefined)).toBeNull()
  })
})

describe('summarizeOutput', () => {
  it('turns a run output into one readable line', () => {
    expect(summarizeOutput({ status: 'ok', queued: 382, discovered: 390, trashed: 0, durationMs: 9000 })).toBe('queued 382 · found 390')
    expect(summarizeOutput({ status: 'rate-limited' })).toBe('rate limited')
    expect(summarizeOutput({ status: 'ok' })).toBe('ok')
    expect(summarizeOutput(null)).toBeNull()
  })
})

describe('buildJobsOverview', () => {
  it('classifies jobs as running (live lease), scheduled (future waitUntil) or waiting (due)', () => {
    const o = build([], [
      job('npm-stats', { processingUntil: at(10).toISOString() }),
      job('npm-stats', { processingUntil: at(-10).toISOString() }), // expired lease = waiting again
      job('discover', { waitUntil: at(30).toISOString() }),
      job('revalidate', { waitUntil: at(-2).toISOString() }),
    ])
    expect(o.counts).toEqual({ running: 1, waiting: 2, scheduled: 1, failed7d: 0 })
    expect(o.queues.find((q) => q.queue === 'default')).toEqual({ queue: 'default', running: 1, waiting: 2 })
  })

  it('reports a fan-out run as done = queued − still pending, counting only jobs created since the run started', () => {
    const start = at(-20)
    const rows = [row('discover', { lastSuccessAt: start, details: { status: 'ok', queued: 60 } })]
    const active = [
      ...Array.from({ length: 4 }, () => job('sync-repository', { queue: 'sync', createdAt: at(-19).toISOString(), processingUntil: at(5).toISOString() })),
      ...Array.from({ length: 16 }, () => job('sync-repository', { queue: 'sync', createdAt: at(-19).toISOString() })),
      job('sync-repository', { queue: 'sync', createdAt: at(-60).toISOString() }), // older (e.g. an approval): not part of the run
    ]
    const o = build(rows, active)
    expect(o.runs).toEqual([
      { key: 'plugin-sync', label: 'Plugin sync', startedAt: start.toISOString(), total: 60, done: 40, running: 4, waiting: 16, pct: 67 },
    ])
    expect(o.running).toEqual([]) // run members are shown in the run, not one by one
  })

  it('never shows a run as more than done when more jobs are pending than were queued', () => {
    const o = build([row('discover-templates', { lastSuccessAt: at(-5), details: { queued: 1 } })], [
      job('sync-template', { queue: 'sync' }), job('sync-template', { queue: 'sync' }),
    ])
    expect(o.runs[0]).toMatchObject({ total: 2, done: 0, pct: 0 })
  })

  it('estimates a single running job from the last run duration, capped at 95%', () => {
    const rows = [row('npm-stats', { lastSuccessAt: at(-1440), details: { durationMs: 300_000 } }), row('started:npm-stats', { lastSuccessAt: at(-3) })]
    const o = build(rows, [job('npm-stats', { processingUntil: at(10).toISOString() })])
    expect(o.running[0]).toMatchObject({ task: 'npm-stats', startedAt: at(-3).toISOString(), estimate: { pct: 60, typicalMs: 300_000 } })
    const late = build([rows[0], row('started:npm-stats', { lastSuccessAt: at(-30) })], [job('npm-stats', { processingUntil: at(10).toISOString() })])
    expect(late.running[0].estimate?.pct).toBe(95)
    expect(build([], [job('npm-stats', { processingUntil: at(10).toISOString() })]).running[0].estimate).toBeNull()
  })

  it('names what a running job works on without exposing its whole input', () => {
    const o = build([], [job('sync-template', { queue: 'sync', processingUntil: at(5).toISOString(), input: { fullName: 'acme/site', path: 'apps/web', secret: 'x' } })])
    expect(o.running[0].subject).toBe('acme/site/apps/web')
  })

  it('lists upcoming jobs once per task, earliest first, marking scheduled, retry and due ones', () => {
    const o = build([], [
      job('discover', { waitUntil: at(90).toISOString() }),
      job('discover', { waitUntil: at(30).toISOString() }),
      job('npm-stats', { waitUntil: at(10).toISOString() }), // no schedule given in this test = a rate-limit retry
      job('snapshot', { waitUntil: at(-3).toISOString() }),
    ])
    expect(o.upcoming.map((u) => [u.task, u.kind, u.at])).toEqual([
      ['snapshot', 'due', at(-3).toISOString()],
      ['npm-stats', 'retry', at(10).toISOString()],
      ['discover', 'scheduled', at(30).toISOString()],
    ])
    expect(o.tasks.find((t) => t.slug === 'discover')?.nextAt).toBe(at(30).toISOString())
  })

  it('gives each task a status, its last result and duration, or its sanitized error', () => {
    const o = build([
      row('discover', { lastSuccessAt: at(-30), details: { status: 'ok', queued: 3, durationMs: 4200 } }),
      row('npm-stats', { lastSuccessAt: at(-60 * 30), lastFailureAt: at(-5), lastError: 'boom token ghp_abcdef123' }),
      row('snapshot', { lastSuccessAt: at(-60 * 72) }),
    ], [])
    const t = Object.fromEntries(o.tasks.map((x) => [x.slug, x]))
    expect(t.discover).toMatchObject({ status: 'ok', summary: 'queued 3', durationMs: 4200, schedule: 'every 6 h at :00', manual: true })
    expect(t['npm-stats']).toMatchObject({ status: 'failing', summary: null, lastError: 'boom token [redacted]', lastRunAt: at(-5).toISOString() })
    expect(t.snapshot.status).toBe('overdue')
    expect(t.enrich).toMatchObject({ status: 'never', manual: false })
  })

  it('groups repeated failures and warns when due jobs wait with nothing running', () => {
    const failed = Array.from({ length: 6 }, (_, i) => ({ id: 100 + i, taskSlug: 'revalidate', updatedAt: at(-i).toISOString(), error: { message: 'no secret' } }))
    const o = build([], [job('discover', { createdAt: at(-12).toISOString() })], { failed, failed7d: 6 })
    expect(o.recentFailures).toEqual([{ id: 100, task: 'revalidate', at: at(0).toISOString(), error: 'no secret', times: 6 }])
    expect(o.stalledSinceMs).toBe(12 * 60_000)
    expect(build([], [job('discover', { createdAt: at(-2).toISOString() })]).stalledSinceMs).toBeNull()
  })
})
