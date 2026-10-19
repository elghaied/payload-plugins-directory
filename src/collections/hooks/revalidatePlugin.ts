import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'
import { isUnchangedMaintainerBranding } from '@/collections/hooks/restrictMaintainerPluginEdits'
import { LIST_TAG, pluginTag } from '@/lib/cacheTags'
import { QUEUES } from '@/sync/queues'

/**
 * Admin edits (visibility, trash, tagline, category, tags, slug) must reach the public pages within about a minute,
 * not after the 1 h data cache. One `revalidate` job per write, through `req` so it commits with the write.
 * No `category:<slug>` tag: no cached query listens to it, and LIST_TAG already covers category pages.
 * The job is queued through `req`, so its insert runs in the same transaction as the admin save: if the queue insert
 * fails, the save fails too (catching it would need a savepoint). That is deliberate: failing loudly beats 1 h of silent staleness.
 * System writers that queue their own revalidation (sync, enrich, seeds) pass `context.skipRevalidate`.
 */
/**
 * True when the only difference between the saved and previous document is `maintainers` (and `updatedAt`).
 * `maintainers` is not rendered on any public page or cached query, so approving a claim needs no purge. Decided per
 * document from the saved result (never via the shared request context, which would leak to later writes).
 */
export function isMaintainersOnlyChange(previousDoc: Record<string, unknown> | undefined, doc: Record<string, unknown>): boolean {
  if (!previousDoc) return false
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  if (same(previousDoc.maintainers, doc.maintainers)) return false
  const keys = new Set([...Object.keys(previousDoc), ...Object.keys(doc)])
  for (const key of keys) {
    if (key === 'maintainers' || key === 'updatedAt') continue
    if (!same(previousDoc[key], doc[key])) return false
  }
  return true
}

const skip = (context: unknown) => Boolean((context as { skipRevalidate?: boolean } | undefined)?.skipRevalidate)

export const revalidatePluginChange: CollectionAfterChangeHook = async ({ doc, previousDoc, req, context }) => {
  if (skip(context)) return doc
  // A maintainer save that changed neither tagline nor logo is a no-op. Decided per document here (never via the shared context), so bulk updates stay correct.
  if (isUnchangedMaintainerBranding(req, previousDoc, doc)) return doc
  if (isMaintainersOnlyChange(previousDoc, doc)) return doc
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
