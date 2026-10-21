import type { Payload, Where } from 'payload'
import { listedPluginsWhere } from '@/collections/Plugins'
import { listedTemplatesWhere } from '@/collections/Templates'
import { isListedOnly, SEARCH_SLUG, SEARCHABLE_COLLECTIONS, type SearchableCollection } from './searchDoc'
import { isIndexable, syncSearchDoc } from './sync'

export type ReindexResult = { skipped: boolean; upserted: number; removed: number; failed: number }
export type ReindexOptions = {
  /**
   * Skip unless the index is short of its sources: fewer plugin / template rows than listed plugins / templates, or fewer
   * category / tag rows than categories / tags. A shortfall (a failed or crashed first build, a seed that skipped the index) triggers a full
   * rebuild; extra rows are not a shortfall (the rebuild removes them, a later manual run too). Four cheap counts per
   * boot and no tolerance: any missing row repairs.
   */
  ifIncomplete?: boolean
  /** Replaceable for tests; defaults to `syncSearchDoc`. */
  sync?: typeof syncSearchDoc
}

const PAGE = 200
const key = (collection: string, id: number | string) => `${collection}:${String(id)}`

/** Ids of every source document (trashed and hidden plugins / templates included: `syncSearchDoc` decides what stays indexed). */
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
      ...(isListedOnly(collection) ? { trash: true } : {}),
    } as never)
    ids.push(...(res.docs as { id: number }[]).map((d) => d.id))
    if (!res.hasNextPage) return ids
  }
}

/**
 * Deletes `search` rows whose source no longer exists, was hidden/trashed, or whose `doc` relation is gone (the
 * cascade on `search_rels` leaves such rows behind). `keep` holds the `collection:id` of every document that is indexed
 * or could not be processed (its row is left alone). A row outside `keep` is only deleted after its source is checked
 * again, so a document created or listed while a live run was going keeps the row its hooks wrote.
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
      if (!doc?.relationTo || doc.value === undefined) orphans.push(row.id)
      else if (!keep.has(key(doc.relationTo, doc.value))) {
        const id = Number(doc.value)
        if (!(await isIndexable(payload, doc.relationTo as SearchableCollection, id))) orphans.push(row.id)
      }
    }
    if (!res.hasNextPage) break
  }
  for (let i = 0; i < orphans.length; i += 200) {
    await payload.delete({ collection: SEARCH_SLUG, overrideAccess: true, depth: 0, where: { id: { in: orphans.slice(i, i + 200) } } })
  }
  return orphans.length
}

async function indexIsShort(payload: Payload): Promise<boolean> {
  const count = async (collection: SearchableCollection, where?: Where) =>
    (await payload.count({ collection, overrideAccess: true, ...(where ? { where } : {}) })).totalDocs
  const indexed = async (collection: SearchableCollection) =>
    (await payload.count({ collection: SEARCH_SLUG, overrideAccess: true, where: { 'doc.relationTo': { equals: collection } } })).totalDocs
  for (const [collection, where] of [
    ['plugins', listedPluginsWhere],
    ['categories'],
    ['tags'],
    ['templates', listedTemplatesWhere],
  ] as [SearchableCollection, Where?][]) {
    if ((await indexed(collection)) < (await count(collection, where))) return true
  }
  return false
}

/**
 * Rebuilds every index record from the source collections (system reads; only listed plugins and templates are indexed). Each document
 * is isolated: one failure is logged and counted, never aborts the run. Orphan rows are deleted afterwards.
 */
export async function reindexSearch(payload: Payload, opts: ReindexOptions = {}): Promise<ReindexResult> {
  if (opts.ifIncomplete && !(await indexIsShort(payload))) return { skipped: true, upserted: 0, removed: 0, failed: 0 }
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
