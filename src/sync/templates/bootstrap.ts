import type { Payload } from 'payload'
import { queueManualJob } from '../manualJobs'

/**
 * Queues `discover-templates` when the directory has no templates at all (trashed ones count) and no discovery is
 * due, so a fresh deploy fills the Templates view without waiting up to 6 hours for the schedule.
 * Returns whether it queued a job.
 */
export async function queueFirstTemplateDiscovery(payload: Payload): Promise<boolean> {
  const templates = await payload.count({ collection: 'templates', overrideAccess: true, trash: true })
  if (templates.totalDocs > 0) return false
  return (await queueManualJob(payload, 'discover-templates', new Date())) === 'queued'
}
