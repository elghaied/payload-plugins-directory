import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import { categoryTag, LIST_TAG } from '@/lib/cacheTags'
import { QUEUES } from '@/sync/queues'

/**
 * Category/tag edits change public pages (category pages, filters, plugin badges). Cache revalidation goes through
 * the same `revalidate` job as everything else (Phase 1). Seeding and `ensureAiTag` pass `context.skipRevalidate`.
 * At most three tags per job, far below the endpoint's MAX_TAGS.
 */
async function queueRevalidation(req: PayloadRequest, tags: string[]): Promise<void> {
  await req.payload.jobs.queue({ task: 'revalidate', input: { tags: [...new Set(tags)] }, queue: QUEUES.default, overrideAccess: true, req })
}

const skip = (context: unknown) => Boolean((context as { skipRevalidate?: boolean } | undefined)?.skipRevalidate)

export const revalidateCategoryChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if (skip(context)) return doc
  const tags = [LIST_TAG, categoryTag(doc.slug)]
  // A rename must also drop the old slug's cached category page.
  if (previousDoc?.slug && previousDoc.slug !== doc.slug) tags.push(categoryTag(previousDoc.slug))
  await queueRevalidation(req, tags)
  return doc
}

export const revalidateCategoryDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (!skip(context)) await queueRevalidation(req, [LIST_TAG, categoryTag(doc.slug)])
  return doc
}

/**
 * job_status row stamped when a category is deleted. A delete (also a hierarchy cascade) changes the prompt
 * fingerprint without bumping any updatedAt, so enrich-all's 30-minute edit debounce reads this row as well.
 */
export const TAXONOMY_EDITED_KEY = 'taxonomy-edited-at'

export const markTaxonomyEdited: CollectionAfterDeleteHook = async ({ doc, req }) => {
  const now = new Date()
  await req.payload.db.drizzle
    .insert(jobStatus)
    .values({ key: TAXONOMY_EDITED_KEY, lastSuccessAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: jobStatus.key, set: { lastSuccessAt: now, updatedAt: now } })
  return doc
}

export const revalidateTagChange: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if (!skip(context)) await queueRevalidation(req, [LIST_TAG])
  return doc
}

export const revalidateTagDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (!skip(context)) await queueRevalidation(req, [LIST_TAG])
  return doc
}
