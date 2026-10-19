import type { PayloadRequest } from 'payload'
import { QUEUES } from '@/sync/queues'

/** Phase 1's task. The ONLY place this phase names it. */
export const SYNC_REPOSITORY_TASK = 'sync-repository' as const

/**
 * Queues a sync for `fullName` the way discover does: on the `sync` queue, stamped `source: 'submission'`
 * (so the created plugin is not mislabelled as a topic find) and `discovered: true`.
 */
export async function enqueueRepositorySync(req: PayloadRequest, fullName: string): Promise<void> {
  // System action triggered by an admin approval; jobs are admin-only otherwise.
  await req.payload.jobs.queue({
    task: SYNC_REPOSITORY_TASK,
    input: { fullName, source: 'submission', discovered: true },
    queue: QUEUES.sync,
    req,
    overrideAccess: true,
  })
}
