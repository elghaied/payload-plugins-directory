import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { LIST_TAG, pluginTag } from '@/lib/cacheTags'
import { QUEUES } from '@/sync/queues'

/**
 * Admin edits (visibility, trash, tagline, category, tags, slug) must reach the public pages within about a minute,
 * not after the 1 h data cache. One `revalidate` job per write, through `req` so it commits with the write.
 * No `category:<slug>` tag: no cached query listens to it, and LIST_TAG already covers category pages.
 * System writers that queue their own revalidation (sync, enrich, seeds) pass `context.skipRevalidate`.
 */
const skip = (context: unknown) => Boolean((context as { skipRevalidate?: boolean } | undefined)?.skipRevalidate)

export const revalidatePluginChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if (skip(context)) return doc
  const tags = [LIST_TAG, pluginTag(doc.slug)]
  if (previousDoc?.slug && previousDoc.slug !== doc.slug) tags.push(pluginTag(previousDoc.slug))
  await req.payload.jobs.queue({ task: 'revalidate', input: { tags: [...new Set(tags)] }, queue: QUEUES.default, overrideAccess: true, req })
  return doc
}

export const revalidatePluginDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (skip(context)) return doc
  await req.payload.jobs.queue({
    task: 'revalidate', input: { tags: [LIST_TAG, pluginTag(doc.slug)] }, queue: QUEUES.default, overrideAccess: true, req,
  })
  return doc
}
