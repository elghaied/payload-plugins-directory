import type { Payload, PayloadRequest, Where } from 'payload'
import { relationId } from '@/lib/relationId'
import {
  buildCategorySearchFields,
  buildPluginSearchFields,
  buildTagSearchFields,
  isPubliclyListed,
  SEARCH_SLUG,
  type CategorySource,
  type PluginSource,
  type SearchableCollection,
  type SearchFields,
  type TagSource,
} from './searchDoc'

const docRef = (collection: SearchableCollection, id: number): Where => ({
  and: [{ 'doc.relationTo': { equals: collection } }, { 'doc.value': { equals: id } }],
})

/**
 * `_h_slugPath` / `_h_titlePath` are virtual and computed only when requested, so a category is always read with a
 * `select` that names them (never through `context`, which `req` would carry into unrelated writes).
 */
const CATEGORY_SELECT = { title: true, slug: true, intro: true, _h_slugPath: true, _h_titlePath: true } as const

async function readCategory(payload: Payload, id: number, req?: PayloadRequest) {
  return payload.findByID({
    collection: 'categories',
    id,
    overrideAccess: true,
    depth: 0,
    disableErrors: true,
    select: CATEGORY_SELECT,
    req,
  })
}

/** Builds the indexed fields for one source document, resolving category/tag text (system reads). */
export async function searchFieldsFor(
  payload: Payload,
  collection: SearchableCollection,
  doc: Record<string, unknown>,
  req?: PayloadRequest,
): Promise<SearchFields> {
  if (collection === 'tags') return buildTagSearchFields(doc as unknown as TagSource)
  if (collection === 'categories') {
    // The hook document carries no virtual paths: re-read the category with them requested.
    const id = relationId(doc.id)
    const category = id === undefined ? null : await readCategory(payload, id, req)
    if (!category) throw new Error(`Category ${String(doc.id)} not found while building its search document`)
    return buildCategorySearchFields(category as unknown as CategorySource)
  }

  const categoryId = relationId(doc.category)
  const tagIds = ((doc._h_tags as unknown[] | null | undefined) ?? []).map(relationId).filter((v): v is number => v !== undefined)
  // Sequential on purpose: hooks share the caller's transaction connection.
  const category = categoryId === undefined ? null : await readCategory(payload, categoryId, req)
  if (categoryId !== undefined && category && !category._h_titlePath) {
    throw new Error(`Category ${categoryId} has no _h_titlePath: request the hierarchy paths explicitly when reading it`)
  }
  const tags = tagIds.length
    ? (await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, pagination: false, limit: 0, where: { id: { in: tagIds } }, req })).docs
    : []
  return buildPluginSearchFields(doc as unknown as PluginSource, {
    categoryText: category?._h_titlePath ?? null,
    tagTitles: tags.map((t) => t.title),
  })
}

export async function removeSearchDocs(payload: Payload, collection: SearchableCollection, id: number, req?: PayloadRequest) {
  await payload.delete({ collection: SEARCH_SLUG, overrideAccess: true, depth: 0, where: docRef(collection, id), req })
}

async function loadSource(payload: Payload, collection: SearchableCollection, id: number, req?: PayloadRequest) {
  switch (collection) {
    case 'plugins':
      return payload.findByID({ collection: 'plugins', id, overrideAccess: true, depth: 0, trash: true, disableErrors: true, req })
    case 'categories':
      return payload.findByID({ collection: 'categories', id, overrideAccess: true, depth: 0, disableErrors: true, req })
    case 'tags':
      return payload.findByID({ collection: 'tags', id, overrideAccess: true, depth: 0, disableErrors: true, req })
  }
}

/**
 * Brings the index entry for one document in line with the source: upsert when it should be
 * searchable, delete otherwise (missing, hidden or trashed plugin). Used by reindex and taxonomy hooks;
 * routine creates/updates go through plugin-search's own hooks.
 */
export async function syncSearchDoc(
  payload: Payload,
  collection: SearchableCollection,
  id: number,
  req?: PayloadRequest,
): Promise<'upserted' | 'removed'> {
  const source = await loadSource(payload, collection, id, req)
  if (!source || (collection === 'plugins' && !isPubliclyListed(source as { visibility?: string; deletedAt?: string | null }))) {
    await removeSearchDocs(payload, collection, id, req)
    return 'removed'
  }
  const data = {
    ...(await searchFieldsFor(payload, collection, source as unknown as Record<string, unknown>, req)),
    doc: { relationTo: collection, value: id },
  }
  const existing = await payload.find({
    collection: SEARCH_SLUG,
    overrideAccess: true,
    depth: 0,
    pagination: false,
    limit: 0,
    where: docRef(collection, id),
    req,
  })
  const [first, ...dupes] = existing.docs
  if (dupes.length) {
    await payload.delete({ collection: SEARCH_SLUG, overrideAccess: true, where: { id: { in: dupes.map((d) => d.id) } }, req })
  }
  if (first) await payload.update({ collection: SEARCH_SLUG, id: first.id, overrideAccess: true, depth: 0, data, req })
  else {
    await payload.create({ collection: SEARCH_SLUG, overrideAccess: true, depth: 0, data, req })
    // `search` has no unique constraint on its doc relation, so two syncs of one document (e.g. a resync job and an
    // edit) can both find nothing and both create. Both then see the duplicate here and delete the same extra rows.
    const after = await payload.find({ collection: SEARCH_SLUG, overrideAccess: true, depth: 0, pagination: false, limit: 0, sort: 'id', where: docRef(collection, id), req })
    const extra = after.docs.slice(1).map((d) => d.id)
    if (extra.length) await payload.delete({ collection: SEARCH_SLUG, overrideAccess: true, depth: 0, where: { id: { in: extra } }, req })
  }
  return 'upserted'
}

const PLUGIN_INDEX_KEYS = ['name', 'slug', 'description', 'readme', 'customTagline', 'ai', 'category', '_h_tags', 'visibility', 'deletedAt'] as const

/**
 * Hook documents are built with the caller's `select`, so `visibility` / `deletedAt` (or the indexed text) can be
 * missing. A projected document is replaced by a full read (trashed plugins included) before anything is decided.
 */
export async function resolvePluginDoc<T extends Record<string, unknown>>(payload: Payload, doc: T, req?: PayloadRequest): Promise<Record<string, unknown>> {
  if (PLUGIN_INDEX_KEYS.every((k) => k in doc)) return doc
  const full = await payload.findByID({ collection: 'plugins', id: doc.id as number, overrideAccess: true, depth: 0, trash: true, disableErrors: true, req })
  return (full as unknown as Record<string, unknown> | null) ?? doc
}

/** Whether the source exists now and belongs in the index (a listed, untrashed plugin; any category or tag). */
export async function isIndexable(payload: Payload, collection: SearchableCollection, id: number): Promise<boolean> {
  const source = await loadSource(payload, collection, id)
  if (!source) return false
  return collection !== 'plugins' || isPubliclyListed(source as { visibility?: string; deletedAt?: string | null })
}
