import type { Payload, PayloadRequest } from 'payload'
import { AI_PRESETS } from '@/enrich/presets'
import { aliasTagIds, mergeTagIds } from '@/sync/aliasTags'
import { sameIds } from '@/sync/util'
import { STARTER_CATEGORIES, STARTER_TAGS } from './starter'
import { flattenStarter } from './tree'

export type SeedTaxonomyResult = { categoriesCreated: string[]; tagsCreated: string[]; presetsCreated: string[] }

/** Seeding writes must not queue a revalidate job per category (src/taxonomy/hooks.ts honours this flag). */
// skipSearchSync: the seed migration runs before the `search` table exists; `reindex-search --if-empty` backfills the index.
const seedContext = () => ({ skipRevalidate: true, skipSearchSync: true })

/**
 * Creates the starter categories, alias tags and admin presets that do not exist yet (matched by slug /
 * title). Never updates or deletes: admins own the taxonomy after the first seed (spec §3.1).
 * Rows an admin created with the same slug are left untouched (and used as parents for their starter children).
 */
export async function seedTaxonomy(payload: Payload, opts: { req?: PayloadRequest } = {}): Promise<SeedTaxonomyResult> {
  const base = () => ({ overrideAccess: true as const, depth: 0, context: seedContext(), ...(opts.req ? { req: opts.req } : {}) })
  const result: SeedTaxonomyResult = { categoriesCreated: [], tagsCreated: [], presetsCreated: [] }

  const ids = new Map<string, number>()
  for (const c of flattenStarter(STARTER_CATEGORIES)) {
    const found = await payload.find({ collection: 'categories', ...base(), limit: 1, where: { slug: { equals: c.slug } } })
    if (found.docs[0]) {
      ids.set(c.slug, found.docs[0].id)
      continue
    }
    const parent = c.parentSlug ? (ids.get(c.parentSlug) ?? null) : null
    const doc = await payload.create({
      collection: 'categories',
      ...base(),
      data: { title: c.title, slug: c.slug, intro: c.intro, icon: c.icon, parent },
    })
    ids.set(c.slug, doc.id)
    result.categoriesCreated.push(c.slug)
  }

  for (const t of STARTER_TAGS) {
    const found = await payload.find({ collection: 'tags', ...base(), limit: 1, where: { slug: { equals: t.slug } } })
    if (found.docs[0]) continue
    await payload.create({ collection: 'tags', ...base(), data: { title: t.title, slug: t.slug, aliases: t.aliases, createdBy: 'alias' } })
    result.tagsCreated.push(t.slug)
  }

  for (const preset of AI_PRESETS) {
    const found = await payload.find({
      collection: 'payload-query-presets',
      ...base(),
      limit: 1,
      where: { and: [{ title: { equals: preset.title } }, { relatedCollection: { equals: 'plugins' } }] },
    })
    if (found.docs[0]) continue
    await payload.create({
      collection: 'payload-query-presets',
      ...base(),
      data: {
        title: preset.title,
        relatedCollection: 'plugins',
        isShared: true,
        where: preset.where,
        access: { read: { constraint: 'everyone' }, update: { constraint: 'everyone' }, delete: { constraint: 'everyone' } },
      } as never,
    })
    result.presetsCreated.push(preset.title)
  }
  return result
}

/**
 * Adds alias-mapped tags (repository topics + npm keywords) to every plugin; only adds, never removes.
 * Plugins whose tags are admin-locked are skipped (controller ruling F5).
 */
export async function applyAliasTagsToAll(payload: Payload): Promise<{ updated: string[] }> {
  const tags = (await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, limit: 0, pagination: false })).docs
    .map((t) => ({ id: t.id, aliases: t.aliases }))
  const plugins = (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 1, limit: 0, pagination: false })).docs
  const updated: string[] = []
  for (const p of plugins) {
    if (p.locks?.tags) continue
    const topics = typeof p.repository === 'object' && p.repository ? (p.repository.topics ?? []) : []
    const next = mergeTagIds(p._h_tags as never, aliasTagIds([...topics, ...(p.keywords ?? [])], tags))
    if (sameIds(next, p._h_tags as never)) continue
    await payload.update({
      collection: 'plugins',
      id: p.id,
      overrideAccess: true,
      depth: 0,
      context: seedContext(),
      data: { _h_tags: next },
    })
    updated.push(p.slug)
  }
  return { updated: updated.sort() }
}

/** Topics on nearly every plugin repository; never worth a tag. */
export const IGNORED_TOPICS = new Set(['payload-plugin', 'payload', 'payloadcms', 'payload-cms', 'plugin', 'typescript', 'javascript', 'nodejs', 'react'])

/** Most common repository topics no tag alias covers: a to-do list for the admin, printed by `payload seed-taxonomy`. */
export async function unmappedTopics(payload: Payload, limit = 25): Promise<{ topic: string; count: number }[]> {
  const aliases = new Set(
    (await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, limit: 0, pagination: false })).docs
      .flatMap((t) => (t.aliases ?? []).map((a) => a.toLowerCase())),
  )
  const repos = await payload.find({ collection: 'repositories', overrideAccess: true, depth: 0, limit: 0, pagination: false, select: { topics: true } })
  const counts = new Map<string, number>()
  for (const r of repos.docs) {
    for (const raw of r.topics ?? []) {
      const topic = raw.toLowerCase()
      if (IGNORED_TOPICS.has(topic) || aliases.has(topic)) continue
      counts.set(topic, (counts.get(topic) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, limit)
}
