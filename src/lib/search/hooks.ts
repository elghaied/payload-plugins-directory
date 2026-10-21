import type { CollectionAfterChangeHook, CollectionAfterDeleteHook, CollectionBeforeDeleteHook, PayloadRequest, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import { QUEUES } from '@/sync/queues'
import { RESYNC_IDS_CAP, RESYNC_IDS_PER_JOB, RESYNC_TARGETS, type ResyncTarget, type Taxonomy } from './resync'
import { isPubliclyListed, type SearchableCollection } from './searchDoc'
import { removeSearchDocs, resolvePluginDoc, resolveTemplateDoc } from './sync'

/**
 * Never fail the source write because of the search index. Public reads re-check access on the plugin
 * itself, so a stale index entry cannot expose a hidden plugin; `pnpm payload reindex-search` repairs it.
 */
export async function guarded(req: PayloadRequest, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    req.payload.logger.error({ err, msg: `search: ${what} failed` })
  }
}

/**
 * plugin-search remembers `collection:id` in `req.context.syncedDocsSet` and skips a document already in the set. Payload 4
 * uses the caller's own context object, so a context (or `req`) reused across writes would freeze the index after the first
 * change. Forgetting the key before plugin-search's hook runs makes every write sync; the set only existed to stop
 * nested-docs style recursion, which this app does not use.
 */
export const forgetSyncedDoc =
  (collection: SearchableCollection): CollectionAfterChangeHook =>
  ({ doc, req }) => {
    ;(req.context as { syncedDocsSet?: Set<string> } | undefined)?.syncedDocsSet?.delete(`${collection}:${String(doc.id)}`)
    return doc
  }

/**
 * Writes that must leave the index alone set `context.skipSearchSync` (the taxonomy seed migration runs before the
 * `search` table exists, and a failing insert would abort its transaction). `reindex-search --if-incomplete` backfills.
 */
export const searchSyncSkipped = (context: unknown): boolean => Boolean((context as { skipSearchSync?: boolean } | undefined)?.skipSearchSync)

/** Runs before plugin-search's own afterChange hook (collection hooks first, plugin hooks appended). */
export const removeUnlistedPluginFromSearch: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if (searchSyncSkipped(context) || searchSyncSkipped(req.context)) return doc
  await guarded(req, `removing plugin ${doc.id} from the index`, async () => {
    // `doc` is projected when the caller passed `select`: decide from the full document.
    if (!isPubliclyListed(await resolvePluginDoc(req.payload, doc, req))) await removeSearchDocs(req.payload, 'plugins', doc.id, req)
  })
  return doc
}

/** Same as removeUnlistedPluginFromSearch, for templates (plugin-search's skipSync never deletes a row). */
export const removeUnlistedTemplateFromSearch: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if (searchSyncSkipped(context) || searchSyncSkipped(req.context)) return doc
  await guarded(req, `removing template ${doc.id} from the index`, async () => {
    if (!isPubliclyListed(await resolveTemplateDoc(req.payload, doc, req))) await removeSearchDocs(req.payload, 'templates', doc.id, req)
  })
  return doc
}

/** Plugin jobs carry no `target` (the input shape and job keys they had before templates). */
const queueResync = (req: PayloadRequest, input: { collection: Taxonomy; target: ResyncTarget; id: number; pluginIds?: number[] }) => {
  const { target, ...rest } = input
  return req.payload.jobs.queue({
    task: 'search-resync',
    input: target === 'plugins' ? rest : input,
    queue: QUEUES.default,
    overrideAccess: true,
    req,
  })
}

/** `undefined` (a projected hook document) counts as changed: an extra job is cheap, a missed one leaves stale text. */
const differs = (doc: Record<string, unknown>, previous: Record<string, unknown> | undefined, key: string, ref = false) => {
  if (!(key in doc) || !previous || !(key in previous)) return true
  return ref ? relationId(doc[key]) !== relationId(previous[key]) : doc[key] !== previous[key]
}

/**
 * Plugin and template rows embed category title paths and tag titles, so a rename (or a category move, which changes
 * every descendant's path) must refresh them. Queued, not inline: the fan-out can be hundreds of documents. A tag change
 * queues one job per target (plugins, templates); each category tree queues only its own kind.
 */
export const resyncPluginsOnTaxonomyChange =
  (collection: Taxonomy): CollectionAfterChangeHook =>
  async ({ doc, previousDoc, operation, req, context }) => {
    if (operation !== 'update' || searchSyncSkipped(context) || searchSyncSkipped(req.context)) return doc
    const changed =
      collection !== 'tags'
        ? differs(doc, previousDoc, 'title') || differs(doc, previousDoc, 'slug') || differs(doc, previousDoc, 'parent', true)
        : differs(doc, previousDoc, 'title')
    if (changed) {
      for (const target of RESYNC_TARGETS[collection]) {
        await guarded(req, `queueing the ${target} resync for ${collection} ${doc.id}`, () => queueResync(req, { collection, target, id: doc.id }))
      }
    }
    return doc
  }

const RESYNC_KEY = 'searchResyncPluginIds'
const referencing = (collection: Taxonomy, id: number | string): Where =>
  collection === 'tags' ? { _h_tags: { in: [id] } } : { category: { equals: id } }
const rememberKey = (collection: Taxonomy, target: ResyncTarget, id: number | string) =>
  target === 'plugins' ? `${RESYNC_KEY}:${collection}:${id}` : `${RESYNC_KEY}:${target}:${collection}:${id}`

/** The relationship is nulled by the delete itself, so the referencing plugins (and templates) are collected first (capped). */
export const rememberPluginsBeforeTaxonomyDelete =
  (collection: Taxonomy): CollectionBeforeDeleteHook =>
  async ({ id, req, context }) => {
    if (searchSyncSkipped(context) || searchSyncSkipped(req.context)) return
    for (const target of RESYNC_TARGETS[collection]) {
      await guarded(req, `collecting ${target} for ${collection} ${id}`, async () => {
        const res = await req.payload.find({
          collection: target,
          overrideAccess: true,
          depth: 0,
          limit: RESYNC_IDS_CAP + 1,
          pagination: false,
          select: { slug: true },
          where: referencing(collection, id),
          req,
        })
        if (res.docs.length > RESYNC_IDS_CAP) {
          req.payload.logger.warn(`search: ${collection} ${id} had more than ${RESYNC_IDS_CAP} ${target}; run 'payload reindex-search' to refresh the rest`)
        }
        ;(req.context as Record<string, unknown>)[rememberKey(collection, target, id)] = res.docs.slice(0, RESYNC_IDS_CAP).map((d) => d.id)
      })
    }
  }

export const resyncPluginsAfterTaxonomyDelete =
  (collection: Taxonomy): CollectionAfterDeleteHook =>
  async ({ id, doc, req }) => {
    for (const target of RESYNC_TARGETS[collection]) {
      const key = rememberKey(collection, target, id)
      const ids = (req.context as Record<string, unknown>)[key] as number[] | undefined
      delete (req.context as Record<string, unknown>)[key]
      if (ids?.length) {
        await guarded(req, `queueing the ${target} resync after ${collection} ${id} delete`, async () => {
          for (let i = 0; i < ids.length; i += RESYNC_IDS_PER_JOB) {
            await queueResync(req, { collection, target, id: Number(id), pluginIds: ids.slice(i, i + RESYNC_IDS_PER_JOB) })
          }
        })
      }
    }
    return doc
  }
