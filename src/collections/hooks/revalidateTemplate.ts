import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'
import { isMaintainersOnlyChange } from '@/collections/hooks/revalidatePlugin'
import { isUnchangedMaintainerTemplateEdit } from '@/collections/hooks/restrictMaintainerTemplateEdits'
import { TEMPLATES_TAG, templateCategoryTag, templateRevalidationTagsFor } from '@/lib/cacheTags'
import { QUEUES } from '@/sync/queues'

/**
 * Template-category edits change template pages and filters. One `revalidate` job per write, queued through `req` so it
 * commits with the write. Seeds and other system writers pass `context.skipRevalidate`.
 */
const skip = (context: unknown) => Boolean((context as { skipRevalidate?: boolean } | undefined)?.skipRevalidate)

async function queueRevalidation(req: PayloadRequest, tags: string[]): Promise<void> {
  await req.payload.jobs.queue({ task: 'revalidate', input: { tags: [...new Set(tags)] }, queue: QUEUES.default, overrideAccess: true, req })
}

export const revalidateTemplateCategoryChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if (skip(context)) return doc
  const tags = [TEMPLATES_TAG, templateCategoryTag(doc.slug)]
  // A rename must also drop the old slug's cached category page.
  if (previousDoc?.slug && previousDoc.slug !== doc.slug) tags.push(templateCategoryTag(previousDoc.slug))
  await queueRevalidation(req, tags)
  return doc
}

export const revalidateTemplateCategoryDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (!skip(context)) await queueRevalidation(req, [TEMPLATES_TAG, templateCategoryTag(doc.slug)])
  return doc
}

export const revalidateTemplateChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if (skip(context)) return doc
  // A maintainer save that changed none of the owner fields is a no-op. Decided per document (never via the shared context).
  if (isUnchangedMaintainerTemplateEdit(req, previousDoc, doc)) return doc
  // `maintainers` is not rendered on any public page or cached query: approving a claim needs no purge.
  if (isMaintainersOnlyChange(previousDoc, doc)) return doc
  const slugs = [doc.slug]
  if (previousDoc?.slug && previousDoc.slug !== doc.slug) slugs.push(previousDoc.slug)
  await queueRevalidation(req, templateRevalidationTagsFor(slugs))
  return doc
}

export const revalidateTemplateDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (!skip(context)) await queueRevalidation(req, templateRevalidationTagsFor([doc.slug]))
  return doc
}
