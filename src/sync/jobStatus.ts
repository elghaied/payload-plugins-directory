import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import type { GitHubQuota } from './github'

export const GITHUB_QUOTA_KEY = 'github-quota'

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
