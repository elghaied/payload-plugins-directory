import type { Payload } from 'payload'
import { SEARCH_SLUG, SEARCHABLE_COLLECTIONS, type SearchableCollection } from './searchDoc'
import { syncSearchDoc } from './sync'

export type ReindexResult = { skipped: boolean; upserted: number; removed: number; failed: number }
export type ReindexOptions = {
  ifEmpty?: boolean
  /** Replaceable for tests; defaults to `syncSearchDoc`. */
  sync?: typeof syncSearchDoc
}

const PAGE = 200
const key = (collection: string, id: number | string) => `${collection}:${String(id)}`

/** Ids of every source document (trashed and hidden plugins included: `syncSearchDoc` decides what stays indexed). */
async function sourceIds(payload: Payload, collection: SearchableCollection): Promise<number[]> {
  const ids: number[] = []
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection,
      overrideAccess: true,
      depth: 0,
      page,
      limit: PAGE,
      sort: 'id',
      select: { slug: true },
      ...(collection === 'plugins' ? { trash: true } : {}),
    } as never)
    ids.push(...(res.docs as { id: number }[]).map((d) => d.id))
    if (!res.hasNextPage) return ids
  }
}

/**
 * Deletes `search` rows whose source no longer exists, was hidden/trashed, or whose `doc` relation is gone (the
 * cascade on `search_rels` leaves such rows behind). `keep` holds the `collection:id` of every document that is indexed
 * or could not be processed (its row is left alone).
 */
async function deleteOrphans(payload: Payload, keep: Set<string>): Promise<number> {
  const orphans: (number | string)[] = []
  for (let page = 1; ; page++) {
    const res = await payload.find({
      collection: SEARCH_SLUG,
      overrideAccess: true,
      depth: 0,
      page,
      limit: 500,
      sort: 'id',
      select: { doc: true },
    })
    for (const row of res.docs) {
      const doc = row.doc as { relationTo?: string; value?: number | string } | null | undefined
      if (!doc?.relationTo || doc.value === undefined || !keep.has(key(doc.relationTo, doc.value))) orphans.push(row.id)
    }
    if (!res.hasNextPage) break
  }
  for (let i = 0; i < orphans.length; i += 200) {
    await payload.delete({ collection: SEARCH_SLUG, overrideAccess: true, depth: 0, where: { id: { in: orphans.slice(i, i + 200) } } })
  }
  return orphans.length
}

/**
 * Rebuilds every index record from the source collections (system reads; only listed plugins are indexed). Each document
 * is isolated: one failure is logged and counted, never aborts the run. Orphan rows are deleted afterwards.
 */
export async function reindexSearch(payload: Payload, opts: ReindexOptions = {}): Promise<ReindexResult> {
  if (opts.ifEmpty) {
    const { totalDocs } = await payload.count({ collection: SEARCH_SLUG, overrideAccess: true })
    if (totalDocs > 0) return { skipped: true, upserted: 0, removed: 0, failed: 0 }
  }
  const sync = opts.sync ?? syncSearchDoc
  let upserted = 0
  let removed = 0
  let failed = 0
  const keep = new Set<string>()
  for (const collection of SEARCHABLE_COLLECTIONS) {
    for (const id of await sourceIds(payload, collection)) {
      try {
        if ((await sync(payload, collection, id)) === 'upserted') {
          upserted++
          keep.add(key(collection, id))
        } else removed++
      } catch (err) {
        failed++
        keep.add(key(collection, id))
        payload.logger.error({ err, msg: `search: reindex failed for ${collection} ${id}` })
      }
    }
  }
  removed += await deleteOrphans(payload, keep)
  return { skipped: false, upserted, removed, failed }
}
