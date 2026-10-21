import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Payload, Where } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import type { GitHubQuota } from './github'
import { QUEUES } from './queues'

export const GITHUB_QUOTA_KEY = 'github-quota'
/**
 * Last time the discover guard tripped (`lastSuccessAt`) and its warning (`details`). Kept apart from the `discover`
 * row so a later failed run cannot hide it; the guard is current when this row is at least as new as discover's
 * last success.
 */
export const DISCOVER_GUARD_KEY = 'discover-guard'

export async function recordJobSuccess(payload: Payload, key: string, details: Record<string, unknown>, now: Date): Promise<void> {
  await payload.db.drizzle
    .insert(jobStatus)
    .values({ key, lastSuccessAt: now, details, updatedAt: now })
    .onConflictDoUpdate({
      target: jobStatus.key, set: { lastSuccessAt: now, details, updatedAt: now },
      // never let an older write overwrite a newer one
      setWhere: sql`${jobStatus.lastSuccessAt} is null or ${jobStatus.lastSuccessAt} <= excluded.last_success_at`,
    })
}

export async function recordJobFailure(payload: Payload, key: string, error: unknown, now: Date): Promise<void> {
  const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
  await payload.db.drizzle
    .insert(jobStatus)
    .values({ key, lastFailureAt: now, lastError, updatedAt: now })
    .onConflictDoUpdate({
      target: jobStatus.key, set: { lastFailureAt: now, lastError, updatedAt: now },
      setWhere: sql`${jobStatus.lastFailureAt} is null or ${jobStatus.lastFailureAt} <= excluded.last_failure_at`,
    })
}

/** Last GitHub core-API quota a task saw (the widget shows it); no-op when the task made no API call. */
export async function recordGitHubQuota(payload: Payload, quota: GitHubQuota | null, now: Date): Promise<void> {
  if (quota) await recordJobSuccess(payload, GITHUB_QUOTA_KEY, quota, now)
}

export const MONITORED_TASKS = [
  'discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate', 'enrich-all', 'enrich-batch', 'enrich',
  'discover-templates', 'sync-template',
] as const
export type MonitoredTask = (typeof MONITORED_TASKS)[number]

/** Scheduled tasks only; queued tasks (sync-repository, sync-template, revalidate, enrich, enrich-batch) have no expected rhythm. */
const EXPECTED_EVERY_HOURS: Partial<Record<MonitoredTask, number>> = { discover: 6, 'npm-stats': 24, snapshot: 24, 'enrich-all': 1, 'discover-templates': 6 }

/** A scheduled task is overdue when it has not succeeded within twice its interval. */
export function isOverdue(task: MonitoredTask, lastSuccessAt: Date | null, now: Date): boolean {
  const hours = EXPECTED_EVERY_HOURS[task]
  if (!hours) return false
  return !lastSuccessAt || now.getTime() - lastSuccessAt.getTime() > 2 * hours * 3_600_000
}

export type TaskHealth = {
  slug: MonitoredTask
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastError: string | null
  /** The latest outcome is a failure (lastFailureAt > lastSuccessAt); cancelled non-retryable jobs record failures too. */
  failing: boolean
  overdue: boolean
}

export type JobHealth = {
  tasks: TaskHealth[]
  discoverWarning: string | null
  githubQuota: GitHubQuota | null
  failedJobs7d: number
  pending: { default: number; sync: number; enrich: number }
}

const MAX_ERROR_CHARS = 200

/** Errors can echo request details: mask token-like strings, then truncate, before anything reaches the page. */
export function sanitizeError(message: string | null | undefined): string | null {
  if (!message) return null
  const clean = message
    .replace(/\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/\b(Bearer|Basic|token)\s+\S+/gi, '$1 [redacted]')
    .replace(/\b(secret|token|authorization|password)=\S+/gi, '$1=[redacted]')
  return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}…` : clean
}

/**
 * Admin dashboard data. Runs with the Local API's `overrideAccess: true` on purpose: it is only called from the
 * dashboard widget, which checks `isAdminUser` first, and is exposed through no endpoint.
 */
export async function getJobHealth(payload: Payload, now: Date): Promise<JobHealth> {
  const rows = new Map((await payload.db.drizzle.select().from(jobStatus)).map((r) => [r.key, r]))
  const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
  const tasks = MONITORED_TASKS.map((slug): TaskHealth => {
    const r = rows.get(slug)
    return {
      slug,
      lastSuccessAt: iso(r?.lastSuccessAt),
      lastFailureAt: iso(r?.lastFailureAt),
      lastError: sanitizeError(r?.lastError),
      failing: !!r?.lastFailureAt && (!r.lastSuccessAt || r.lastFailureAt > r.lastSuccessAt),
      overdue: isOverdue(slug, r?.lastSuccessAt ?? null, now),
    }
  })

  // Failed = hasError, which includes jobs cancelled as non-retryable (error.cancelled).
  const notFinished: Where = {
    and: [{ completedAt: { exists: false } }, { or: [{ hasError: { equals: false } }, { hasError: { exists: false } }] }],
  }
  const pendingIn = async (queue: string) =>
    (await payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { and: [notFinished, { queue: { equals: queue } }] } })).totalDocs
  const since = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  const [failed, pendingDefault, pendingSync, pendingEnrich] = await Promise.all([
    payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { and: [{ hasError: { equals: true } }, { updatedAt: { greater_than: since } }] } }),
    pendingIn(QUEUES.default),
    pendingIn(QUEUES.sync),
    pendingIn(QUEUES.enrich),
  ])

  // Shown only while current: the guard row is stamped with the same `at` as the discover run that tripped it.
  const guard = rows.get(DISCOVER_GUARD_KEY)
  const discover = rows.get('discover')
  let discoverWarning: string | null = null
  if (guard?.lastSuccessAt && discover?.lastSuccessAt && guard.lastSuccessAt >= discover.lastSuccessAt) {
    const { known, knownSeen, warning } = guard.details ?? {}
    if (typeof known === 'number' && typeof knownSeen === 'number') {
      const incomplete = typeof warning === 'string' && warning.includes('incomplete') ? ' (GitHub search results incomplete)' : ''
      discoverWarning = `Topic-search repositories seen ${knownSeen} of ${known}${incomplete}; no repository was counted as missed or trashed.`
    }
  }

  const quota = rows.get(GITHUB_QUOTA_KEY)?.details as Partial<GitHubQuota> | null | undefined
  const githubQuota =
    quota && typeof quota.remaining === 'number' && typeof quota.limit === 'number' ? (quota as GitHubQuota) : null
  return { tasks, discoverWarning, githubQuota, failedJobs7d: failed.totalDocs, pending: { default: pendingDefault, sync: pendingSync, enrich: pendingEnrich } }
}
