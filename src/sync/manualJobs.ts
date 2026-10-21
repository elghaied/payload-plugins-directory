import type { Payload } from 'payload'
import { QUEUES } from './queues'

/**
 * Directory-wide jobs an admin may start from the dashboard instead of waiting for their schedule. Per-item tasks
 * (sync-repository, sync-template, enrich, enrich-template, revalidate, search-resync) need an input and stay out.
 * Each runs with the input its schedule uses.
 */
export const MANUAL_JOBS = [
  { task: 'discover', label: 'Discover plugins', hint: 'Find new and changed plugins on GitHub' },
  { task: 'discover-templates', label: 'Discover templates', hint: 'Refresh the official and listed community templates' },
  { task: 'npm-stats', label: 'npm stats', hint: 'Update weekly downloads' },
  { task: 'snapshot', label: 'Daily snapshot', hint: "Record today's stars and downloads (safe to repeat)" },
  { task: 'render-readmes', label: 'Render READMEs', hint: 'Re-render README HTML that is out of date' },
  {
    task: 'enrich-all',
    label: 'AI enrichment',
    hint: 'Summarise stale plugins and templates',
    confirm: 'This may call the Anthropic API and spend AI credit. Run it now?',
  },
] as const satisfies readonly { task: string; label: string; hint: string; confirm?: string }[]

export type ManualJob = (typeof MANUAL_JOBS)[number]
export type ManualJobTask = ManualJob['task']

export const isManualJobTask = (task: string): task is ManualJobTask => MANUAL_JOBS.some((j) => j.task === task)

/**
 * Whether a job for `task` is waiting to run now or running. A job Payload's scheduler queued ahead for its next slot
 * (`waitUntil` in the future) does not count: it may be hours away.
 */
export async function hasDuePendingJob(payload: Payload, task: string, now: Date): Promise<boolean> {
  const pending = await payload.count({
    collection: 'payload-jobs',
    overrideAccess: true,
    where: {
      and: [
        { taskSlug: { equals: task } },
        { completedAt: { exists: false } },
        { hasError: { not_equals: true } },
        { or: [{ waitUntil: { exists: false } }, { waitUntil: { less_than_equal: now.toISOString() } }] },
      ],
    },
  })
  return pending.totalDocs > 0
}

/** Queues `task` for the worker's next tick unless one is already due or running. */
export async function queueManualJob(payload: Payload, task: ManualJobTask, now: Date): Promise<'queued' | 'already-pending'> {
  if (await hasDuePendingJob(payload, task, now)) return 'already-pending'
  await payload.jobs.queue({ task, input: {}, queue: QUEUES.default, overrideAccess: true })
  return 'queued'
}
