import type { Payload, Where } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import { DISCOVER_GUARD_KEY, GITHUB_QUOTA_KEY, isOverdue, MONITORED_TASKS, sanitizeError, type MonitoredTask } from './jobStatus'
import type { GitHubQuota } from './github'
import { isManualJobTask } from './manualJobs'
import { QUEUES } from './queues'
import { startedKey } from './taskKit'

/**
 * Data for the dashboard's Jobs widget. Payload deletes a job once it completes, so "now" (running, waiting,
 * scheduled) comes from the live job queue and "done" comes from job_status (last success / failure per task, with
 * the run's output and duration, written by `track`).
 */

/** Tasks shown in the widget, in display order. */
export const DASHBOARD_TASKS = [
  'discover', 'sync-repository', 'discover-templates', 'sync-template', 'npm-stats', 'snapshot', 'render-readmes',
  'enrich-all', 'enrich', 'enrich-batch', 'enrich-template', 'revalidate',
] as const
export type DashboardTask = (typeof DASHBOARD_TASKS)[number]

/** A fan-out run: one job queues many, so "done" = queued − still pending. */
const RUNS = [
  { key: 'plugin-sync', label: 'Plugin sync', source: 'discover', tasks: ['sync-repository'], totals: ['queued'] },
  { key: 'template-sync', label: 'Template sync', source: 'discover-templates', tasks: ['sync-template'], totals: ['queued'] },
  { key: 'enrichment', label: 'AI enrichment', source: 'enrich-all', tasks: ['enrich', 'enrich-template'], totals: ['queued', 'templatesQueued'] },
] as const

export type StatusRow = { key: string; lastSuccessAt: Date | null; lastFailureAt: Date | null; lastError: string | null; details: Record<string, unknown> | null; updatedAt: Date | null }
export type ActiveJob = { id: number; taskSlug: string; queue: string | null; createdAt: string; waitUntil: string | null; processingUntil: string | null; input: unknown; totalTried: number | null }
export type FailedJob = { id: number; taskSlug: string; updatedAt: string; error: unknown }

export type JobState = 'running' | 'waiting' | 'scheduled'
export type RunningJob = { id: number; task: string; subject: string | null; startedAt: string | null; estimate: { pct: number; typicalMs: number } | null }
export type ActiveRun = { key: string; label: string; startedAt: string; total: number; done: number; running: number; waiting: number; pct: number }
export type UpcomingJob = { task: string; at: string; kind: 'scheduled' | 'retry' | 'due'; manual: boolean }
export type TaskRow = {
  slug: DashboardTask
  schedule: string | null
  manual: boolean
  status: 'ok' | 'failing' | 'overdue' | 'never'
  lastRunAt: string | null
  summary: string | null
  durationMs: number | null
  lastError: string | null
  nextAt: string | null
  running: number
  waiting: number
}
export type JobsOverview = {
  counts: { running: number; waiting: number; scheduled: number; failed7d: number }
  queues: { queue: string; running: number; waiting: number }[]
  running: RunningJob[]
  runs: ActiveRun[]
  upcoming: UpcomingJob[]
  tasks: TaskRow[]
  /** Latest failed jobs, one per task + error (`times` = how many of the loaded ones match). */
  recentFailures: { id: number; task: string; at: string; error: string | null; times: number }[]
  githubQuota: GitHubQuota | null
  discoverWarning: string | null
  /** Due jobs have waited this long with nothing running: the worker may be down. */
  stalledSinceMs: number | null
}

/** Human form of the cron patterns this project uses; null for anything else. */
export function describeCron(cron: string | undefined): string | null {
  if (!cron) return null
  const [m, h, dom, mon, dow] = cron.trim().split(/\s+/)
  if (dom !== '*' || mon !== '*' || dow !== '*' || !/^\d+$/.test(m)) return null
  const mm = m.padStart(2, '0')
  if (h === '*') return `hourly at :${mm}`
  const every = /^\*\/(\d+)$/.exec(h)
  if (every) return `every ${every[1]} h at :${mm}`
  if (/^\d+$/.test(h)) return `daily ${h.padStart(2, '0')}:${mm} UTC`
  return null
}

const OUTPUT_FIELDS: [key: string, label: string][] = [
  ['queued', 'queued'], ['autoListed', 'auto-listed'], ['suggested', 'suggested'], ['templatesQueued', 'templates queued'], ['discovered', 'found'], ['checked', 'checked'],
  ['updated', 'updated'], ['rendered', 'rendered'], ['considered', 'considered'], ['repositories', 'repos'],
  ['plugins', 'plugins'], ['count', 'tags'], ['applied', 'applied'], ['stale', 'stale'], ['trashed', 'trashed'],
  ['created', 'created'], ['failed', 'failed'], ['errors', 'errors'],
]

/** One readable line from a run's output, e.g. "queued 382 · found 390". */
export function summarizeOutput(details: Record<string, unknown> | null | undefined): string | null {
  if (!details) return null
  const parts: string[] = []
  const status = typeof details.status === 'string' ? details.status : null
  if (status && status !== 'ok') parts.push(status.replace(/-/g, ' '))
  for (const [key, label] of OUTPUT_FIELDS) {
    const v = details[key]
    if (typeof v === 'number' && (v > 0 || key === 'queued')) parts.push(`${label} ${v}`)
  }
  return parts.length ? parts.slice(0, 4).join(' · ') : status
}

/** What a job is working on, from its input (a repository, a plugin or template id). Never the whole input. */
function subjectOf(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const i = input as Record<string, unknown>
  if (typeof i.fullName === 'string') return i.path ? `${i.fullName}/${String(i.path)}` : i.fullName
  if (typeof i.pluginId === 'number') return `plugin #${i.pluginId}`
  if (typeof i.templateId === 'number') return `template #${i.templateId}`
  if (typeof i.collection === 'string') return i.collection
  return null
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const ms = (s: string | null) => (s ? Date.parse(s) : NaN)

export function stateOf(job: Pick<ActiveJob, 'waitUntil' | 'processingUntil'>, now: Date): JobState {
  if (job.processingUntil && ms(job.processingUntil) > now.getTime()) return 'running'
  if (job.waitUntil && ms(job.waitUntil) > now.getTime()) return 'scheduled'
  return 'waiting'
}

export function buildJobsOverview(args: {
  now: Date
  rows: StatusRow[]
  active: ActiveJob[]
  failed: FailedJob[]
  failed7d: number
  schedules: Partial<Record<string, string>>
}): JobsOverview {
  const { now, rows, active, failed, failed7d, schedules } = args
  const byKey = new Map(rows.map((r) => [r.key, r]))
  const states = active.map((j) => ({ job: j, state: stateOf(j, now) }))
  const count = (pred: (x: (typeof states)[number]) => boolean) => states.filter(pred).length

  const queues = [QUEUES.default, QUEUES.sync, QUEUES.enrich].map((queue) => ({
    queue,
    running: count((x) => x.job.queue === queue && x.state === 'running'),
    waiting: count((x) => x.job.queue === queue && x.state === 'waiting'),
  }))

  // Fan-out runs still in progress.
  const runs: ActiveRun[] = []
  const inRun = new Set<number>()
  for (const def of RUNS) {
    const src = byKey.get(def.source)
    if (!src?.lastSuccessAt) continue
    const start = src.lastSuccessAt.getTime()
    const members = states.filter((x) => (def.tasks as readonly string[]).includes(x.job.taskSlug) && ms(x.job.createdAt) >= start && x.state !== 'scheduled')
    if (members.length === 0) continue
    members.forEach((x) => inRun.add(x.job.id))
    const queued = def.totals.reduce((sum, k) => sum + (typeof src.details?.[k] === 'number' ? (src.details[k] as number) : 0), 0)
    const total = Math.max(queued, members.length)
    const done = total - members.length
    runs.push({
      key: def.key,
      label: def.label,
      startedAt: src.lastSuccessAt.toISOString(),
      total,
      done,
      running: members.filter((x) => x.state === 'running').length,
      waiting: members.filter((x) => x.state === 'waiting').length,
      pct: total ? Math.round((done / total) * 100) : 0,
    })
  }

  // Running jobs outside a fan-out run, with a duration-based estimate.
  const running: RunningJob[] = states
    .filter((x) => x.state === 'running' && !inRun.has(x.job.id))
    .map(({ job }) => {
      const started = byKey.get(startedKey(job.taskSlug))?.lastSuccessAt ?? null
      const typical = byKey.get(job.taskSlug)?.details?.durationMs
      const elapsed = started ? now.getTime() - started.getTime() : null
      const estimate =
        typeof typical === 'number' && typical > 0 && elapsed !== null && elapsed >= 0
          ? { pct: Math.min(95, Math.round((elapsed / typical) * 100)), typicalMs: typical }
          : null
      return { id: job.id, task: job.taskSlug, subject: subjectOf(job.input), startedAt: iso(started), estimate }
    })

  // Upcoming: the scheduler's pre-queued jobs (one per task, earliest first), rate-limit retries, and due scheduled ones.
  const seen = new Set<string>()
  const upcoming: UpcomingJob[] = states
    .filter((x) => x.job.waitUntil && x.state !== 'running')
    .sort((a, b) => ms(a.job.waitUntil) - ms(b.job.waitUntil))
    .flatMap(({ job, state }) => {
      if (seen.has(job.taskSlug)) return []
      seen.add(job.taskSlug)
      const kind: UpcomingJob['kind'] = state === 'waiting' ? 'due' : schedules[job.taskSlug] ? 'scheduled' : 'retry'
      return [{ task: job.taskSlug, at: job.waitUntil as string, kind, manual: isManualJobTask(job.taskSlug) }]
    })

  const tasks: TaskRow[] = DASHBOARD_TASKS.map((slug) => {
    const r = byKey.get(slug)
    const success = r?.lastSuccessAt ?? null
    const failure = r?.lastFailureAt ?? null
    const failing = !!failure && (!success || failure > success)
    const overdue = (MONITORED_TASKS as readonly string[]).includes(slug) && isOverdue(slug as MonitoredTask, success, now)
    const last = failing ? failure : success
    const mine = states.filter((x) => x.job.taskSlug === slug)
    return {
      slug,
      schedule: schedules[slug] ?? null,
      manual: isManualJobTask(slug),
      status: !success && !failure ? 'never' : failing ? 'failing' : overdue ? 'overdue' : 'ok',
      lastRunAt: iso(last),
      summary: failing ? null : summarizeOutput(r?.details),
      durationMs: !failing && typeof r?.details?.durationMs === 'number' ? (r.details.durationMs as number) : null,
      lastError: failing ? sanitizeError(r?.lastError) : null,
      nextAt: upcoming.find((u) => u.task === slug)?.at ?? null,
      running: mine.filter((x) => x.state === 'running').length,
      waiting: mine.filter((x) => x.state === 'waiting').length,
    }
  })

  const recentFailures: JobsOverview['recentFailures'] = []
  for (const f of failed) {
    const e = f.error as { message?: unknown; cancelled?: unknown } | string | null
    const error = sanitizeError(typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : null)
    const same = recentFailures.find((r) => r.task === f.taskSlug && r.error === error)
    if (same) same.times++
    else if (recentFailures.length < 5) recentFailures.push({ id: f.id, task: f.taskSlug, at: f.updatedAt, error, times: 1 })
  }

  const quotaDetails = byKey.get(GITHUB_QUOTA_KEY)?.details as Partial<GitHubQuota> | null | undefined
  const githubQuota =
    quotaDetails && typeof quotaDetails.remaining === 'number' && typeof quotaDetails.limit === 'number' ? (quotaDetails as GitHubQuota) : null

  const guard = byKey.get(DISCOVER_GUARD_KEY)
  const discover = byKey.get('discover')
  let discoverWarning: string | null = null
  if (guard?.lastSuccessAt && discover?.lastSuccessAt && guard.lastSuccessAt >= discover.lastSuccessAt) {
    const { known, knownSeen } = guard.details ?? {}
    if (typeof known === 'number' && typeof knownSeen === 'number') {
      discoverWarning = `The last discovery saw ${knownSeen} of ${known} known repositories, so nothing was trashed.`
    }
  }

  // Worker health: due jobs that have waited a while with nothing running.
  const due = states.filter((x) => x.state === 'waiting').map((x) => ms(x.job.waitUntil ?? x.job.createdAt))
  const nothingRunning = !states.some((x) => x.state === 'running')
  const oldestDue = due.length ? Math.min(...due) : null
  const stalledSinceMs = nothingRunning && oldestDue !== null && now.getTime() - oldestDue > 5 * 60_000 ? now.getTime() - oldestDue : null

  return {
    counts: {
      running: count((x) => x.state === 'running'),
      waiting: count((x) => x.state === 'waiting'),
      scheduled: count((x) => x.state === 'scheduled'),
      failed7d,
    },
    queues,
    running,
    runs,
    upcoming,
    tasks,
    recentFailures,
    githubQuota,
    discoverWarning,
    stalledSinceMs,
  }
}

/**
 * Loads the widget's data. Runs with `overrideAccess: true` on purpose: only the dashboard widget calls it, after its
 * own `isAdminUser` check, and no endpoint exposes it.
 */
export async function getJobsOverview(payload: Payload, now: Date): Promise<JobsOverview> {
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const failedWhere: Where = { and: [{ hasError: { equals: true } }, { updatedAt: { greater_than: since } }] }
  const [rows, active, failed] = await Promise.all([
    payload.db.drizzle.select().from(jobStatus),
    payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      depth: 0,
      limit: 0,
      pagination: false,
      where: { and: [{ completedAt: { exists: false } }, { hasError: { not_equals: true } }] },
      select: { taskSlug: true, queue: true, createdAt: true, waitUntil: true, processingUntil: true, input: true, totalTried: true },
    }),
    payload.find({
      collection: 'payload-jobs',
      overrideAccess: true,
      depth: 0,
      limit: 50,
      sort: '-updatedAt',
      where: failedWhere,
      select: { taskSlug: true, updatedAt: true, error: true },
    }),
  ])
  const schedules: Partial<Record<string, string>> = {}
  for (const task of payload.config.jobs.tasks ?? []) {
    const cron = Array.isArray(task.schedule) ? task.schedule[0]?.cron : undefined
    const text = describeCron(cron)
    if (text) schedules[task.slug] = text
  }
  return buildJobsOverview({
    now,
    rows: rows as StatusRow[],
    active: active.docs as unknown as ActiveJob[],
    failed: failed.docs as unknown as FailedJob[],
    failed7d: failed.totalDocs,
    schedules,
  })
}
