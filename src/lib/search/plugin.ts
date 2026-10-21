import type { Field } from 'payload'
import { searchPlugin } from '@payloadcms/plugin-search'
import type { BeforeSync, SearchPluginConfig } from '@payloadcms/plugin-search/types'
import { isAdmin } from '@/access'
import { isPubliclyListed, KIND_BY_COLLECTION, SEARCH_FIELD_LIMITS, SEARCHABLE_COLLECTIONS, type SearchableCollection } from './searchDoc'
import { searchSyncSkipped } from './hooks'
import { resolvePluginDoc, searchFieldsFor } from './sync'

const ro = { readOnly: true }
const searchFields: Field[] = [
  { name: 'kind', type: 'select', required: true, index: true, options: ['plugin', 'category', 'tag'], admin: { ...ro, position: 'sidebar' } },
  { name: 'slug', type: 'text', required: true, index: true, maxLength: SEARCH_FIELD_LIMITS.slug, admin: ro },
  { name: 'tagline', type: 'text', maxLength: SEARCH_FIELD_LIMITS.tagline, admin: ro },
  { name: 'summary', type: 'textarea', maxLength: SEARCH_FIELD_LIMITS.summary, admin: ro },
  { name: 'categoryText', type: 'text', maxLength: SEARCH_FIELD_LIMITS.categoryText, admin: ro },
  { name: 'tagsText', type: 'text', maxLength: SEARCH_FIELD_LIMITS.tagsText, admin: ro },
  {
    name: 'readme',
    type: 'textarea',
    maxLength: SEARCH_FIELD_LIMITS.readme,
    admin: { ...ro, description: 'First 50,000 characters; used only for full-text matching.' },
  },
  { name: 'path', type: 'text', maxLength: SEARCH_FIELD_LIMITS.path, admin: ro },
]

// Returning true makes plugin-search return early WITHOUT deleting an existing record —
// removeUnlistedPluginFromSearch (hooks.ts) handles removal.
const skipSync: NonNullable<SearchPluginConfig['skipSync']> = async ({ collectionSlug, doc, req }) => {
  if (searchSyncSkipped(req.context)) return true
  // A projected hook document (caller passed `select`) is replaced by a full read before deciding.
  return collectionSlug === 'plugins' && !isPubliclyListed(await resolvePluginDoc(req.payload, doc, req))
}

const beforeSync: BeforeSync = async ({ collectionSlug, originalDoc, payload, req, searchDoc }) => {
  const collection = collectionSlug as SearchableCollection
  try {
    const source = collection === 'plugins' ? await resolvePluginDoc(payload, originalDoc, req) : originalDoc
    return { ...searchDoc, ...(await searchFieldsFor(payload, collection, source, req)) }
  } catch (err) {
    // plugin-search does not catch beforeSync errors: a throw would fail the source write (e.g. a sync job).
    payload.logger.error({ err, msg: `search: could not build index fields for ${collection} ${String(originalDoc.id)}` })
    return {
      ...searchDoc,
      title: String(originalDoc.name ?? originalDoc.title ?? '').slice(0, SEARCH_FIELD_LIMITS.title),
      kind: KIND_BY_COLLECTION[collection],
      slug: String(originalDoc.slug ?? '').slice(0, SEARCH_FIELD_LIMITS.slug),
    }
  }
}

export const directorySearchPlugin = () =>
  searchPlugin({
    collections: [...SEARCHABLE_COLLECTIONS],
    defaultPriorities: { plugins: 30, categories: 20, tags: 10 },
    beforeSync,
    skipSync,
    reindexBatchSize: 100,
    searchOverrides: {
      // Keep the plugin's default `create: () => false` (overriding it breaks the admin Reindex permission check).
      access: { read: isAdmin, update: isAdmin, delete: isAdmin },
      admin: { group: 'System', defaultColumns: ['title', 'kind', 'slug'] },
      fields: ({ defaultFields }) => [
        ...defaultFields.map((f) => ('name' in f && f.name === 'title' && f.type === 'text' ? { ...f, maxLength: SEARCH_FIELD_LIMITS.title } : f)),
        ...searchFields,
      ],
    },
  })
