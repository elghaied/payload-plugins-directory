import type { Payload } from 'payload'
import type { Plugin } from '@/payload-types'
import { leafCategories, toCategoryNodes, type CategoryNode } from '@/taxonomy/tree'
import { buildSystemPrompt, DEFAULT_MODEL, promptFingerprint } from './prompt'
import { buildOutputSchema } from './schema'
import type { EnrichSettings, PluginInput, TagRef } from './types'

export type EnrichContext = {
  settings: EnrichSettings
  nodes: CategoryNode[]
  leaves: CategoryNode[]
  tags: TagRef[]
  system: string
  schema: Record<string, unknown>
  fingerprint: string
}

/** `directory-settings.ai` (spec §3.3). A never-saved global reads as enabled, Sonnet 5.5, 2 new tags. */
export async function loadSettings(payload: Payload): Promise<EnrichSettings> {
  const settings = await payload.findGlobal({ slug: 'directory-settings', overrideAccess: true, depth: 0 })
  const ai = settings.ai ?? {}
  return {
    enabled: ai.enabled !== false,
    model: ai.model?.trim() || DEFAULT_MODEL,
    instructions: ai.instructions ?? '',
    maxNewTagsPerPlugin: Math.max(0, Math.min(5, ai.maxNewTagsPerPlugin ?? 2)),
  }
}

export async function loadTagRefs(payload: Payload): Promise<TagRef[]> {
  const res = await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, limit: 0, pagination: false, sort: 'slug' })
  return res.docs.map((t) => ({ id: t.id, slug: t.slug, title: t.title, aliases: t.aliases ?? [], createdBy: t.createdBy ?? 'admin' }))
}

/** Paths are requested explicitly (computeHierarchyPaths); toCategoryNodes throws when a child has none (ruling F1). */
export async function loadCategoryNodes(payload: Payload): Promise<CategoryNode[]> {
  const res = await payload.find({
    collection: 'categories',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    context: { computeHierarchyPaths: true },
  })
  return toCategoryNodes(res.docs)
}

/** Everything one enrichment pass shares: settings, taxonomy, the cached system prompt, the schema, the fingerprint. */
export async function loadEnrichContext(payload: Payload): Promise<EnrichContext> {
  const [settings, nodes, tags] = await Promise.all([loadSettings(payload), loadCategoryNodes(payload), loadTagRefs(payload)])
  const leaves = leafCategories(nodes)
  return {
    settings,
    nodes,
    leaves,
    tags,
    system: buildSystemPrompt({ nodes, leaves, tags }, settings),
    // No leaves: nothing can be classified and runEnrich skips ('no-categories'); buildOutputSchema would throw.
    schema: leaves.length ? buildOutputSchema(leaves.map((l) => l.slug).sort(), tags.map((t) => t.slug)) : {},
    fingerprint: promptFingerprint({ nodes, leaves }, settings),
  }
}

/** Identifies one attempted input; a failure with the current key is not retried by enrich-all. */
export const failureKey = (contentHash: string | null | undefined, fingerprint: string): string => `${contentHash ?? ''}:${fingerprint}`

const LOCKABLE = ['category', 'tags', 'tagline', 'summary', 'features', 'useCases'] as const
export const allLocked = (locks: Plugin['locks']): boolean => LOCKABLE.every((k) => Boolean(locks?.[k]))

/** Non-trashed plugin with its repository populated (for topics), or null. */
export async function findActivePlugin(payload: Payload, id: number): Promise<Plugin | null> {
  const res = await payload.find({ collection: 'plugins', overrideAccess: true, depth: 1, limit: 1, where: { id: { equals: id } } })
  return res.docs[0] ?? null
}

export function toPluginInput(plugin: Plugin): PluginInput {
  const repo = typeof plugin.repository === 'object' && plugin.repository ? plugin.repository : null
  return {
    name: plugin.name,
    packageName: plugin.packageName ?? null,
    description: plugin.description ?? null,
    topics: (repo?.topics ?? []).filter((t) => t !== 'payload-plugin'),
    keywords: plugin.keywords ?? [],
    payloadVersionRange: plugin.payloadVersionRange ?? null,
    readme: plugin.readme ?? null,
  }
}
