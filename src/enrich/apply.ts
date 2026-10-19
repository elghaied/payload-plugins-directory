import type { Payload } from 'payload'
import type { Plugin } from '@/payload-types'
import { categoryTag, revalidationTagsFor } from '@/lib/cacheTags'
import { aliasTagIds } from '@/sync/aliasTags'
import { findActivePlugin, loadSettings, toPluginInput, type EnrichContext } from './context'
import type { CleanEnrichment } from './types'

export type ApplyArgs = { pluginId: number; contentHash: string | null; fingerprint: string; model: string; result: CleanEnrichment; now: Date }
export type ApplyResult = { status: 'applied' | 'stale' | 'missing' | 'disabled'; revalidateTags: string[]; createdTags: string[] }

const WRITE = { overrideAccess: true as const, depth: 0, context: { enrichment: true } }

/**
 * Writes one validated enrichment (spec §5.1, §5.3). The kill switch and the plugin are re-read right before
 * writing, so turning AI off or locking a field while the model answered still wins, and an answer for older
 * content is dropped. Writes only `ai`, `category` and `_h_tags` (alias-mapped tags always stay); new tags are
 * created with createdBy 'ai'. Every other plugin field is left exactly as it was.
 */
export async function applyEnrichment(payload: Payload, ctx: EnrichContext, args: ApplyArgs): Promise<ApplyResult> {
  const none = { revalidateTags: [] as string[], createdTags: [] as string[] }
  if (!(await loadSettings(payload)).enabled) return { status: 'disabled', ...none }
  const plugin = await findActivePlugin(payload, args.pluginId)
  if (!plugin) return { status: 'missing', ...none }
  if ((plugin.contentHash ?? null) !== args.contentHash) return { status: 'stale', ...none }

  const locks = plugin.locks ?? {}
  const { result } = args
  const data: Partial<Plugin> = {}
  const createdTags: string[] = []
  const oldCategory = typeof plugin.category === 'object' && plugin.category ? plugin.category.slug : null
  let newCategory = oldCategory

  if (!locks.category) {
    const leaf = ctx.leaves.find((l) => l.slug === result.category)
    if (leaf) {
      data.category = leaf.id
      newCategory = leaf.slug
    }
  }

  if (!locks.tags) {
    const tagIds = new Set<number>()
    const bySlug = new Map(ctx.tags.map((t) => [t.slug, t.id]))
    for (const slug of result.tags.existing) {
      const id = bySlug.get(slug)
      if (id) tagIds.add(id)
    }
    for (const t of result.tags.created) {
      const tag = await ensureAiTag(payload, t)
      tagIds.add(tag.id)
      if (tag.created) createdTags.push(t.slug)
    }
    const input = toPluginInput(plugin)
    for (const id of aliasTagIds([...input.topics, ...input.keywords], ctx.tags)) tagIds.add(id)
    data._h_tags = [...tagIds].sort((a, b) => a - b)
  }

  data.ai = {
    ...(plugin.ai ?? {}),
    ...(locks.tagline ? {} : { tagline: result.tagline }),
    ...(locks.summary ? {} : { summary: result.summary }),
    ...(locks.features ? {} : { features: result.features }),
    ...(locks.useCases ? {} : { useCases: result.useCases }),
    confidence: result.confidence,
    model: args.model,
    enrichedAt: args.now.toISOString(),
    enrichedHash: args.contentHash,
    promptHash: args.fingerprint,
    failure: null,
    failedAt: null,
    failedKey: null,
  }

  await payload.update({ collection: 'plugins', id: plugin.id, ...WRITE, data })
  const tags = revalidationTagsFor([plugin.slug])
  for (const slug of new Set([oldCategory, newCategory])) if (slug) tags.push(categoryTag(slug))
  return { status: 'applied', revalidateTags: tags, createdTags }
}

async function ensureAiTag(payload: Payload, tag: { slug: string; title: string }): Promise<{ id: number; created: boolean }> {
  const found = await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, limit: 1, where: { slug: { equals: tag.slug } } })
  if (found.docs[0]) return { id: found.docs[0].id, created: false }
  const doc = await payload.create({
    collection: 'tags',
    overrideAccess: true,
    depth: 0,
    context: { skipRevalidate: true },
    data: { title: tag.title, slug: tag.slug, createdBy: 'ai' },
  })
  return { id: doc.id, created: true }
}

/**
 * Refusal / max_tokens / invalid output: keep every value, remember what failed (spec §5.2). Nothing when AI is off
 * (re-read here) or when the plugin's content changed since the request was built (the failure is for old input).
 */
export async function recordEnrichmentFailure(
  payload: Payload,
  args: { pluginId: number; contentHash: string | null; reason: string; key: string; now: Date },
): Promise<void> {
  if (!(await loadSettings(payload)).enabled) return
  const plugin = await findActivePlugin(payload, args.pluginId)
  if (!plugin || (plugin.contentHash ?? null) !== args.contentHash) return
  await payload.update({
    collection: 'plugins',
    id: plugin.id,
    ...WRITE,
    data: { ai: { ...(plugin.ai ?? {}), failure: args.reason.slice(0, 200), failedAt: args.now.toISOString(), failedKey: args.key } },
  })
}
