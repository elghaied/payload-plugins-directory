import type { Payload } from 'payload'
import { QUEUES } from '@/sync/queues'

/**
 * Queues `discover-templates` when the directory has no templates at all (trashed ones count) and no discovery is
 * pending, so a fresh deploy fills the Templates view without waiting up to 6 hours for the schedule.
 * Returns whether it queued a job.
 */
export async function queueFirstTemplateDiscovery(payload: Payload): Promise<boolean> {
  const templates = await payload.count({ collection: 'templates', overrideAccess: true, trash: true })
  if (templates.totalDocs > 0) return false
  const pending = await payload.count({
    collection: 'payload-jobs',
    overrideAccess: true,
    where: { and: [{ taskSlug: { equals: 'discover-templates' } }, { completedAt: { exists: false } }, { hasError: { not_equals: true } }] },
  })
  if (pending.totalDocs > 0) return false
  await payload.jobs.queue({ task: 'discover-templates', input: {}, queue: QUEUES.default, overrideAccess: true })
  return true
}
