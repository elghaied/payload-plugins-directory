import type { Payload } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import type { GitHubQuota } from './github'

export const GITHUB_QUOTA_KEY = 'github-quota'

export async function recordJobSuccess(payload: Payload, key: string, details: Record<string, unknown>, now: Date): Promise<void> {
  await payload.db.drizzle
    .insert(jobStatus)
    .values({ key, lastSuccessAt: now, details, updatedAt: now })
    .onConflictDoUpdate({ target: jobStatus.key, set: { lastSuccessAt: now, details, updatedAt: now } })
}

export async function recordJobFailure(payload: Payload, key: string, error: unknown, now: Date): Promise<void> {
  const lastError = (error instanceof Error ? error.message : String(error)).slice(0, 1000)
  await payload.db.drizzle
    .insert(jobStatus)
    .values({ key, lastFailureAt: now, lastError, updatedAt: now })
    .onConflictDoUpdate({ target: jobStatus.key, set: { lastFailureAt: now, lastError, updatedAt: now } })
}

/** Last GitHub core-API quota a task saw (the widget shows it); no-op when the task made no API call. */
export async function recordGitHubQuota(payload: Payload, quota: GitHubQuota | null, now: Date): Promise<void> {
  if (quota) await recordJobSuccess(payload, GITHUB_QUOTA_KEY, quota, now)
}
