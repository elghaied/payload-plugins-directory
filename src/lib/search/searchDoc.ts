import { authorDescriptionOf, pluginTagline } from '@/lib/directory/tagline'
import { clampChars, NAME_MAX_CHARS, PATH_MAX_CHARS } from '@/sync/limits'

export const SEARCH_SLUG = 'search' as const
export const SEARCHABLE_COLLECTIONS = ['plugins', 'categories', 'tags'] as const
export type SearchableCollection = (typeof SEARCHABLE_COLLECTIONS)[number]
export type SearchKind = 'plugin' | 'category' | 'tag'
export const KIND_BY_COLLECTION: Record<SearchableCollection, SearchKind> = {
  plugins: 'plugin',
  categories: 'category',
  tags: 'tag',
}
/** README characters indexed per plugin; keeps each tsvector far below Postgres' 1 MB limit. */
export const README_INDEX_LIMIT = 50_000

/**
 * The `maxLength` of every text field of the `search` collection (Task 3 uses these for the field config) and the clamp
 * the builders apply. Payload 4 rejects text over `defaultMaxTextLength` (40,000) unless a field sets its own
 * `maxLength`, and a failed sync write leaves the index stale, so builder and field must agree.
 */
export const SEARCH_FIELD_LIMITS = {
  title: NAME_MAX_CHARS,
  slug: NAME_MAX_CHARS,
  tagline: 500,
  summary: 5_000,
  categoryText: 1_000,
  tagsText: 5_000,
  readme: README_INDEX_LIMIT,
  path: PATH_MAX_CHARS,
} as const

export type SearchFields = {
  title: string
  kind: SearchKind
  slug: string
  tagline: string | null
  summary: string | null
  categoryText: string | null
  tagsText: string | null
  readme: string | null
  path: string | null
}

type Maybe<T> = T | null | undefined

export type PluginSource = {
  name: string
  slug: string
  description?: Maybe<string>
  readme?: Maybe<string>
  customTagline?: Maybe<string>
  ai?: Maybe<{ tagline?: Maybe<string>; summary?: Maybe<string> }>
}
/** `_h_slugPath` / `_h_titlePath` are virtual: the caller reads the category with them requested explicitly. */
export type CategorySource = { title: string; slug: string; intro?: Maybe<string>; _h_slugPath?: Maybe<string>; _h_titlePath?: Maybe<string> }
export type TagSource = { title: string; slug: string; aliases?: Maybe<string[]> }

export function isPubliclyListed(doc: { visibility?: Maybe<string>; deletedAt?: Maybe<string> }): boolean {
  return doc.visibility === 'listed' && !doc.deletedAt
}

const clamp = (value: Maybe<string>, field: keyof typeof SEARCH_FIELD_LIMITS): string | null => {
  const text = value?.trim()
  return text ? clampChars(text, SEARCH_FIELD_LIMITS[field]) : null
}

const joinOrNull = (parts: Maybe<string>[], sep: string, field: keyof typeof SEARCH_FIELD_LIMITS) => {
  const kept = parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p))
  return kept.length ? clamp(kept.join(sep), field) : null
}

/**
 * `taxonomy.categoryText` is the category's full title path, resolved by the caller from a read that requested
 * `_h_titlePath`; it is never derived from the slug here.
 */
export function buildPluginSearchFields(
  doc: PluginSource,
  taxonomy: { categoryText: string | null; tagTitles: string[] },
): SearchFields {
  // The sync placeholder ("No description available") is not the author's words and must not match queries.
  const description = authorDescriptionOf(doc.description)
  return {
    title: clampChars(doc.name, SEARCH_FIELD_LIMITS.title),
    kind: 'plugin',
    slug: clampChars(doc.slug, SEARCH_FIELD_LIMITS.slug),
    tagline: clamp(pluginTagline({ customTagline: doc.customTagline, ai: doc.ai ?? undefined, description }), 'tagline'),
    summary: joinOrNull([doc.ai?.summary, description], '\n', 'summary'),
    categoryText: clamp(taxonomy.categoryText, 'categoryText'),
    tagsText: joinOrNull(taxonomy.tagTitles, ' ', 'tagsText'),
    readme: doc.readme ? clampChars(doc.readme, SEARCH_FIELD_LIMITS.readme) : null,
    path: null,
  }
}

export function buildCategorySearchFields(doc: CategorySource): SearchFields {
  if (!doc._h_slugPath) throw new Error(`Category "${doc.slug}" has no _h_slugPath: request the hierarchy paths explicitly when reading it`)
  if (!doc._h_titlePath) throw new Error(`Category "${doc.slug}" has no _h_titlePath: request the hierarchy paths explicitly when reading it`)
  return {
    title: clampChars(doc.title, SEARCH_FIELD_LIMITS.title),
    kind: 'category',
    slug: clampChars(doc.slug, SEARCH_FIELD_LIMITS.slug),
    tagline: null,
    summary: clamp(doc.intro, 'summary'),
    categoryText: clamp(doc._h_titlePath, 'categoryText'),
    tagsText: null,
    readme: null,
    path: clampChars(doc._h_slugPath, SEARCH_FIELD_LIMITS.path),
  }
}

export function buildTagSearchFields(doc: TagSource): SearchFields {
  return {
    title: clampChars(doc.title, SEARCH_FIELD_LIMITS.title),
    kind: 'tag',
    slug: clampChars(doc.slug, SEARCH_FIELD_LIMITS.slug),
    tagline: null,
    summary: null,
    categoryText: null,
    tagsText: joinOrNull(doc.aliases ?? [], ' ', 'tagsText'),
    readme: null,
    path: null,
  }
}
