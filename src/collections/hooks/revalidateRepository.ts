import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, PayloadRequest } from 'payload'
import { LIST_TAG, pluginTag } from '@/lib/cacheTags'
import { MAX_TAGS } from '@/lib/revalidate'
import { QUEUES } from '@/sync/queues'

/**
 * Admin edits to a repository (fullName, owner, avatar, stars...) show on every plugin card and detail page of that
 * repository. One `revalidate` job per write: LIST_TAG plus the `plugin:<slug>` tag of each plugin in the repository,
 * capped at MAX_TAGS. System writers (sync, seed) pass `context.skipRevalidate`; sync queues its own tags.
 *
 * The job is queued through `req`, so the insert runs in the same transaction as the admin save. If the queue insert
 * fails, the whole save fails (a savepoint would be needed to keep the write): failing loudly beats silent 1 h staleness.
 */
const skip = (context: unknown) => Boolean((context as { skipRevalidate?: boolean } | undefined)?.skipRevalidate)

async function queueRepositoryRevalidation(repositoryId: number | string, req: PayloadRequest) {
  const plugins = await req.payload.find({
    collection: 'plugins',
    where: { repository: { equals: repositoryId } },
    overrideAccess: true,
    trash: true,
    depth: 0,
    limit: MAX_TAGS,
    pagination: false,
    select: { slug: true },
    req,
  })
  const tags = [...new Set([LIST_TAG, ...plugins.docs.map((p) => pluginTag(p.slug))])].slice(0, MAX_TAGS)
  await req.payload.jobs.queue({ task: 'revalidate', input: { tags }, queue: QUEUES.default, overrideAccess: true, req })
}

export const revalidateRepositoryChange: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if (skip(context)) return doc
  await queueRepositoryRevalidation(doc.id, req)
  return doc
}

export const revalidateRepositoryDelete: CollectionAfterDeleteHook = async ({ doc, req, context }) => {
  if (skip(context)) return doc
  await queueRepositoryRevalidation(doc.id, req)
  return doc
}
