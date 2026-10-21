import type { Payload } from 'payload'
import { QUEUES } from '@/sync/queues'

/**
 * Queues `discover-templates` when the directory has no templates at all (trashed ones count) and no discovery is
 * pending, so a fresh deploy fills the Templates view without waiting up to 6 hours for the schedule.
 * Returns whether it queued a job. A job Payload's scheduler queued ahead for its next slot (`waitUntil` in the
 * future) does not count as pending: it may be hours away.
 */
export async function queueFirstTemplateDiscovery(payload: Payload): Promise<boolean> {
  const templates = await payload.count({ collection: 'templates', overrideAccess: true, trash: true })
  if (templates.totalDocs > 0) return false
  const pending = await payload.count({
    collection: 'payload-jobs',
    overrideAccess: true,
    where: {
      and: [
        { taskSlug: { equals: 'discover-templates' } },
        { completedAt: { exists: false } },
        { hasError: { not_equals: true } },
        { or: [{ waitUntil: { exists: false } }, { waitUntil: { less_than_equal: new Date().toISOString() } }] },
      ],
    },
  })
  if (pending.totalDocs > 0) return false
  await payload.jobs.queue({ task: 'discover-templates', input: {}, queue: QUEUES.default, overrideAccess: true })
  return true
}
