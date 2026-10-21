import type { Payload, TaskConfig, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import { QUEUES } from '@/sync/queues'
import { syncSearchDoc } from './sync'

export type Taxonomy = 'categories' | 'tags'
export type ResyncInput = { collection: Taxonomy; id: number; pluginIds?: number[] | null; afterId?: number | null }

/** Plugins read per query. */
export const RESYNC_BATCH = 100
/** Plugins refreshed per job run; a longer fan-out continues in a follow-up job. */
export const RESYNC_JOB_CAP = 500
/** Plugin ids carried by one delete-triggered job, and the most ids collected for one deleted taxonomy entry. */
export const RESYNC_IDS_PER_JOB = 200
export const RESYNC_IDS_CAP = 5_000

/** The category and all of its descendants (a rename or move changes every descendant's title path). */
async function categoryAndDescendants(payload: Payload, id: number): Promise<number[]> {
  const all = (await payload.find({ collection: 'categories', overrideAccess: true, depth: 0, pagination: false, limit: 0, select: { parent: true } })).docs
  const children = new Map<number, number[]>()
  for (const c of all) {
    const parent = relationId(c.parent)
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), c.id])
  }
  const found = [id]
  for (const next of found) found.push(...(children.get(next) ?? []))
  return found
}

const pluginsWhere = (collection: Taxonomy, ids: number[], afterId?: number | null): Where => {
  const base: Where = collection === 'categories' ? { category: { in: ids } } : { _h_tags: { in: ids } }
  return afterId ? { and: [base, { id: { greater_than: afterId } }] } : base
}

async function syncOne(payload: Payload, collection: 'plugins' | 'categories', id: number, tally: { synced: number; failed: number }) {
  try {
    await syncSearchDoc(payload, collection, id)
    tally.synced++
  } catch (err) {
    tally.failed++
    payload.logger.error({ err, msg: `search: resync failed for ${collection} ${id}` })
  }
}

/**
 * Refreshes the search rows that embed a category or tag title: the plugins in it (and, for a category, its
 * descendants' own rows). Runs as a job so a rename never fans out inside the admin request. System writes without `req`,
 * so every document is its own transaction and context. `reindex-search` repairs anything this misses.
 */
export async function runTaxonomyResync(
  payload: Payload,
  input: ResyncInput,
  queueMore: (next: ResyncInput) => Promise<unknown>,
  limits: { batch?: number; cap?: number } = {},
): Promise<{ synced: number; failed: number; continued: boolean }> {
  const batch = limits.batch ?? RESYNC_BATCH
  const cap = limits.cap ?? RESYNC_JOB_CAP
  const tally = { synced: 0, failed: 0 }
  if (input.pluginIds?.length) {
    for (const id of input.pluginIds) await syncOne(payload, 'plugins', id, tally)
    return { ...tally, continued: false }
  }

  const ids = input.collection === 'categories' ? await categoryAndDescendants(payload, input.id) : [input.id]
  if (input.collection === 'categories' && !input.afterId) {
    for (const id of ids) await syncOne(payload, 'categories', id, tally)
  }
  let last = input.afterId ?? 0
  let handled = 0
  while (handled < cap) {
    const res = await payload.find({
      collection: 'plugins',
      overrideAccess: true,
      depth: 0,
      limit: batch,
      pagination: false,
      sort: 'id',
      select: { slug: true },
      where: pluginsWhere(input.collection, ids, last || null),
    })
    for (const { id } of res.docs) {
      await syncOne(payload, 'plugins', id, tally)
      last = id
      handled++
    }
    if (res.docs.length < batch) return { ...tally, continued: false }
  }
  await queueMore({ collection: input.collection, id: input.id, afterId: last })
  return { ...tally, continued: true }
}

export const searchResyncTask: TaskConfig<'search-resync'> = {
  slug: 'search-resync',
  label: 'Refresh search rows after a taxonomy change',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  inputSchema: [
    { name: 'collection', type: 'select', required: true, options: ['categories', 'tags'] },
    { name: 'id', type: 'number', required: true },
    { name: 'pluginIds', type: 'number', hasMany: true },
    { name: 'afterId', type: 'number' },
  ],
  outputSchema: [
    { name: 'synced', type: 'number' },
    { name: 'failed', type: 'number' },
    { name: 'continued', type: 'checkbox' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const output = await runTaxonomyResync(payload, input as ResyncInput, (next) =>
      payload.jobs.queue({ task: 'search-resync', input: next, queue: QUEUES.default, overrideAccess: true }),
    )
    if (output.failed) payload.logger.warn(`search: ${output.failed} document(s) failed to resync; run 'payload reindex-search' to repair`)
    return { output }
  },
}
