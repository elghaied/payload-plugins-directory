import { JobCancelledError, type Payload, type TaskConfig } from 'payload'
import { getEnrichClient, getSyncDeps } from '@/sync/deps'
import { QUEUES } from '@/sync/queues'
import { queueRevalidate, track } from '@/sync/taskKit'
import { BATCH_POLL_MS, cancelBatchQuietly, clearInflight, runEnrichAll, runEnrichBatch, type EnrichBatchInput } from './batch'
import { runEnrich } from './enrichPlugin'
import { queueEnrich } from './queue'
import type { EnrichClient } from './types'

/** A fresh poll job, not a retry: a running batch never uses up enrich-batch's retries (like Phase 1's rate-limit re-queue). */
async function queueEnrichBatch(payload: Payload, input: EnrichBatchInput, now: Date): Promise<void> {
  await payload.jobs.queue({
    task: 'enrich-batch',
    input,
    queue: QUEUES.default,
    waitUntil: new Date(now.getTime() + BATCH_POLL_MS),
    overrideAccess: true,
  })
}

const usageFields = [
  { name: 'inputTokens', type: 'number' },
  { name: 'outputTokens', type: 'number' },
  { name: 'cacheReadTokens', type: 'number' },
] as const

const enrichTask: TaskConfig<'enrich'> = {
  slug: 'enrich',
  label: 'Enrich plugin (AI)',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  // A newer queued enrich of the same plugin replaces one that has not started (sync, enrich-all, batch retries, CLI).
  concurrency: { key: ({ input }) => `enrich:${input.pluginId}`, supersedes: true },
  inputSchema: [{ name: 'pluginId', type: 'number', required: true }],
  outputSchema: [{ name: 'status', type: 'text' }, { name: 'reason', type: 'text' }, ...usageFields],
  handler: async ({ input, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const output = await track(payload, 'enrich', deps.now(), async () => {
      const r = await runEnrich(payload, input.pluginId, getEnrichClient(deps), deps.now)
      await queueRevalidate(payload, r.revalidateTags)
      return {
        status: r.status,
        ...(r.reason ? { reason: r.reason } : {}),
        inputTokens: r.usage.input,
        outputTokens: r.usage.output,
        cacheReadTokens: r.usage.cacheRead,
      }
    })
    return { output }
  },
}

const enrichAllTask: TaskConfig<'enrich-all'> = {
  slug: 'enrich-all',
  label: 'Enrich stale plugins (AI)',
  schedule: [{ cron: '20 * * * *', queue: QUEUES.default }],
  // Never retried: the next hourly run is the retry, and a retried pass must not race a batch it may have created.
  retries: 0,
  concurrency: () => 'enrich-all',
  inputSchema: [{ name: 'force', type: 'checkbox' }],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'stale', type: 'number' },
    { name: 'queued', type: 'number' },
    { name: 'batchId', type: 'text' },
    { name: 'warning', type: 'text' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const at = deps.now()
    const output = await track(payload, 'enrich-all', at, async () => {
      // No API key is a successful no-op: the status says so and the warning reaches the job health row.
      const r = await runEnrichAll(payload, getEnrichClient(deps), at, { force: Boolean(input?.force) })
      const queued = await queueEnrich(payload, r.direct)
      // Same run: the poller exists as soon as the batch does (the in-flight marker covers a crash in between).
      if (r.batch) await queueEnrichBatch(payload, r.batch, at)
      return {
        status: r.status,
        stale: r.stale,
        queued,
        ...(r.batch ? { batchId: r.batch.batchId } : {}),
        ...(r.warning ? { warning: r.warning } : {}),
      }
    })
    return { output }
  },
}

const BATCH_ATTEMPTS = 5

/**
 * Payload fails a job for good when its task has already failed `attempts` times (handleTaskError compares the
 * task's logged tries with the retry attempts); this run is then the last one.
 */
function isFinalAttempt(job: { taskStatus?: unknown }, slug: string, attempts: number): boolean {
  // Single-task jobs run their task under the id '1' (runJobs' singleTask workflow).
  const status = (job.taskStatus as Record<string, Record<string, { totalTried?: number }> | undefined> | undefined)?.[slug]?.['1']
  return (status?.totalTried ?? 0) >= attempts
}

/** Ruling F10: an enrich-batch that gives up cancels its batch (best effort) and clears the in-flight marker. */
async function abandonBatch(payload: Payload, client: EnrichClient | null, batchId: string): Promise<void> {
  const cancelled = await cancelBatchQuietly(client, batchId)
  try {
    await clearInflight(payload, batchId)
  } catch (err) {
    payload.logger.error({ err, msg: `Could not clear the in-flight marker of enrich batch ${batchId}` })
  }
  payload.logger.warn(`Gave up on enrich batch ${batchId} (${cancelled ? 'cancelled' : 'cancel failed'}); its plugins stay stale for the next enrich-all.`)
}

const enrichBatchTask: TaskConfig<'enrich-batch'> = {
  slug: 'enrich-batch',
  label: 'Collect AI batch results',
  retries: { attempts: BATCH_ATTEMPTS, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: { key: ({ input }) => `enrich-batch:${input.batchId}`, supersedes: true },
  inputSchema: [
    { name: 'batchId', type: 'text', required: true },
    { name: 'fingerprint', type: 'text', required: true },
    { name: 'model', type: 'text' },
    { name: 'items', type: 'json', required: true },
  ],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'applied', type: 'number' },
    { name: 'failed', type: 'number' },
    { name: 'retried', type: 'number' },
    ...usageFields,
  ],
  handler: async ({ input, job, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const client = getEnrichClient(deps)
    const at = deps.now()
    const batch = input as unknown as EnrichBatchInput
    try {
      const output = await track(payload, 'enrich-batch', at, async () => {
        const r = await runEnrichBatch(payload, client, batch, at)
        // Still running: poll again later as a fresh job. `not-found` / `stale-prompt` / `cancelled` cleared the marker.
        if (r.status === 'processing') await queueEnrichBatch(payload, batch, at)
        const retried = await queueEnrich(payload, r.retryDirect)
        await queueRevalidate(payload, r.revalidateTags)
        return {
          status: r.status,
          applied: r.applied,
          failed: r.failed,
          retried,
          inputTokens: r.usage.input,
          outputTokens: r.usage.output,
          cacheReadTokens: r.usage.cacheRead,
        }
      })
      return { output }
    } catch (err) {
      // Cancelled (permanent error) or out of retries: no later run will collect this batch.
      if (err instanceof JobCancelledError || isFinalAttempt(job, 'enrich-batch', BATCH_ATTEMPTS)) {
        await abandonBatch(payload, client, batch.batchId)
      }
      throw err
    }
  },
}

export const enrichTasks = [enrichTask, enrichAllTask, enrichBatchTask]
