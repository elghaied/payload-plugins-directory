import type { Payload } from 'payload'
import { QUEUES } from './queues'

/** Jobs run in parallel per batch: `sync` 4 = spec §4 "concurrency 4". Phase 2 adds { queue: 'enrich', limit: 2 }. */
export const WORKER_QUEUES: readonly { queue: string; limit: number }[] = [
  { queue: QUEUES.default, limit: 10 },
  { queue: QUEUES.sync, limit: 4 },
]
/** A tick stops starting new batches after this; `--cron` (croner `protect`) skips ticks while one still runs. */
export const TICK_BUDGET_MS = 50_000

export type WorkerTickResult = { scheduled: number; ran: Record<string, number> }

/**
 * One worker tick: queue due schedules (all queues), then drain each queue in batches until empty or out of budget.
 * `shouldStop` (graceful shutdown) is checked before every new batch; a batch already running always finishes.
 */
export async function runWorkerTick(
  payload: Payload,
  opts: { budgetMs?: number; shouldStop?: () => boolean } = {},
): Promise<WorkerTickResult> {
  const deadline = Date.now() + (opts.budgetMs ?? TICK_BUDGET_MS)
  const stopping = () => opts.shouldStop?.() ?? false
  // Do not queue new schedules once shutting down.
  const { queued } = stopping() ? { queued: [] } : await payload.jobs.handleSchedules({ allQueues: true })
  const ran: Record<string, number> = {}
  await Promise.all(
    WORKER_QUEUES.map(async ({ queue, limit }) => {
      ran[queue] = 0
      while (Date.now() < deadline && !stopping()) {
        const res = await payload.jobs.run({ queue, limit, overrideAccess: true })
        const count = Object.keys(res.jobStatus ?? {}).length
        ran[queue] += count
        // count 0 also covers "jobs exist but are all blocked by a running concurrency key".
        if (res.noJobsRemaining || count === 0) break
      }
    }),
  )
  return { scheduled: queued.length, ran }
}
