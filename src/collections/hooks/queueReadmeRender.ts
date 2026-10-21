import type { CollectionAfterChangeHook } from 'payload'
import { QUEUES } from '@/sync/queues'

/**
 * An edit of `readme` outside sync (an admin in the panel) makes the stored HTML stale: queue the single-flight
 * `render-readmes` job (cheap, picks up exactly the stale rows). The page already ignores HTML whose stamp does not
 * match the current text. Sync passes `context.skipRevalidate` and renders (or defers to the daily job) itself.
 */
export const queueReadmeRender: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if ((context as { skipRevalidate?: boolean } | undefined)?.skipRevalidate) return doc
  if (!previousDoc || (doc.readme ?? null) === (previousDoc.readme ?? null)) return doc
  await req.payload.jobs.queue({ task: 'render-readmes', input: {}, queue: QUEUES.default, overrideAccess: true, req })
  return doc
}
