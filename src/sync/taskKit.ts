import { JobCancelledError, type Payload } from 'payload'
import { isPermanentAnthropicError } from '@/enrich/client'
import { InvalidGitHubPathError, type GitHubClient } from './github'
import { RateLimitError } from './http'
import { recordGitHubQuota, recordJobFailure, recordJobSuccess } from './jobStatus'
import { InvalidNpmPackageNameError } from './npm'
import { QUEUES } from './queues'

export type RateLimited = { status: 'rate-limited' }

/** job_status key holding when the latest run of `slug` started (its `lastSuccessAt`). */
export const startedKey = (slug: string) => `started:${slug}`

export async function queueRevalidate(payload: Payload, tags: readonly string[]): Promise<void> {
  if (tags.length === 0) return
  await payload.jobs.queue({ task: 'revalidate', input: { tags: [...new Set(tags)] }, queue: QUEUES.default, overrideAccess: true })
}

/** Records the GitHub quota the run saw, whether it succeeded or not (the widget shows the latest one). */
export async function withQuota<T>(payload: Payload, github: GitHubClient, at: Date, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } finally {
    await recordGitHubQuota(payload, github.quota, at).catch((err: unknown) =>
      payload.logger.error({ err, msg: 'Could not record the GitHub quota' }),
    )
  }
}

/** The worker is misconfigured: retrying cannot help until someone changes the environment. */
export class SyncConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SyncConfigError'
  }
}

/**
 * Errors that fail the same way on every attempt: the job is failed without using its retries. Includes Anthropic
 * 400/401/403/404 (bad request, bad key, no permission, unknown model — ruling F16).
 */
export const isPermanent = (err: unknown) =>
  err instanceof InvalidGitHubPathError ||
  err instanceof InvalidNpmPackageNameError ||
  err instanceof SyncConfigError ||
  isPermanentAnthropicError(err)

/**
 * Runs a task body and records the outcome in job_status, every write stamped with `at` (one timestamp per run, so
 * rows written by the same run compare equal). A RateLimitError re-queues the job as a fresh job with `waitUntil` =
 * the reset time (spec §4.2) and completes this run, so a rate limit never uses up the task's retries. A permanent
 * error (invalid input, missing configuration) is recorded and the job is cancelled: Payload marks it failed and never
 * retries it. Any other error is recorded and rethrown so Payload's retries (with backoff) apply.
 */
export async function track<T extends Record<string, unknown>>(
  payload: Payload,
  slug: string,
  at: Date,
  run: () => Promise<T>,
  requeue?: (err: RateLimitError) => Promise<unknown>,
): Promise<T | RateLimited> {
  // The dashboard's "running for" (Payload's lease is renewed while a job runs, so it cannot tell when a run began).
  await recordJobSuccess(payload, startedKey(slug), {}, at).catch((err: unknown) =>
    payload.logger.error({ err, msg: `Could not record the start of ${slug}` }),
  )
  const started = Date.now()
  try {
    const output = await run()
    // durationMs: the dashboard shows it and estimates the progress of the next run from it. Not part of the job output.
    await recordJobSuccess(payload, slug, { ...output, durationMs: Date.now() - started }, at)
    return output
  } catch (err) {
    if (err instanceof RateLimitError && requeue) {
      try {
        await requeue(err)
      } catch (requeueErr) {
        await recordJobFailure(payload, slug, requeueErr, at)
        throw requeueErr
      }
      await recordJobSuccess(payload, slug, { status: 'rate-limited', resetAt: err.resetAt.toISOString() }, at)
      return { status: 'rate-limited' }
    }
    await recordJobFailure(payload, slug, err, at)
    if (isPermanent(err)) throw new JobCancelledError(`${(err as Error).message} (not retried)`)
    throw err
  }
}
