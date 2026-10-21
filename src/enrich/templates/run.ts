import type { Payload, Where } from 'payload'
import { templateCategoryTag, templateRevalidationTagsFor } from '@/lib/cacheTags'
import type { Template } from '@/payload-types'
import { aliasTagIds } from '@/sync/aliasTags'
import { ensureAiTag, existingTagIds } from '../apply'
import { DEBOUNCE_MS, DIRECT_MAX, lastTaxonomyEdit, maxPerPassFromEnv } from '../batch'
import { allLocked, failureKey, loadSettings, type EnrichContext } from '../context'
import type { EnrichOutcome, EnrichStatus } from '../enrichPlugin'
import { buildRequest } from '../prompt'
import { interpretMessage, usageOf, ZERO_USAGE } from '../response'
import type { CleanEnrichment, EnrichClient, EnrichMessage } from '../types'
import { validateEnrichment } from '../validate'
import { findActiveTemplate, loadTemplateEnrichContext, toTemplateInput } from './context'
import { buildTemplateUserContent } from './prompt'

/**
 * Template enrichment (Phase 6). Always direct (`enrich-template` jobs), never batched. Mirrors the plugin pipeline
 * (enrichPlugin.ts, apply.ts) on `templates`: same skips, locks, staleness check, kill switch and failure keys.
 */

type Settled = { status: EnrichStatus; reason?: string; revalidateTags: string[] }

/** A fresh `context` per write (Payload v4 keeps the caller's object); `enrichment` lets lockAdminEditedAiFields through. */
const write = () => ({ overrideAccess: true as const, depth: 0, context: { enrichment: true, skipRevalidate: true } })

export async function runEnrichTemplate(payload: Payload, templateId: number, client: EnrichClient | null, now: () => Date): Promise<EnrichOutcome> {
  const skip = (status: EnrichStatus): EnrichOutcome => ({ status, revalidateTags: [], usage: ZERO_USAGE })
  const ctx = await loadTemplateEnrichContext(payload)
  if (!ctx.settings.enabled) return skip('disabled')
  if (!client) return skip('no-api-key')
  if (ctx.leaves.length === 0) return skip('no-categories')
  const template = await findActiveTemplate(payload, templateId)
  if (!template) return skip('missing')
  if (allLocked(template.locks)) return skip('locked')

  const contentHash = template.contentHash ?? null
  const message = await client.createMessage(
    buildRequest({ model: ctx.settings.model, system: ctx.system, schema: ctx.schema }, buildTemplateUserContent(toTemplateInput(template))),
  )
  const settled = await settleTemplateSafely(payload, ctx, { templateId, contentHash, message, now: now() })
  return { ...settled, usage: usageOf(message), model: message.model }
}

type SettleArgs = { templateId: number; contentHash: string | null; message: EnrichMessage; now: Date }

/** As settleSafely: the answer is paid for, so an apply error is recorded (apply-error:*) and never rethrown. */
async function settleTemplateSafely(payload: Payload, ctx: EnrichContext, args: SettleArgs): Promise<Settled> {
  try {
    return await settleTemplateMessage(payload, ctx, args)
  } catch (err) {
    const reason = `apply-error:${err instanceof Error ? err.name : 'unknown'}`
    payload.logger.error({ err, msg: `Could not apply the AI enrichment of template ${args.templateId}; recorded as ${reason}` })
    try {
      const key = failureKey(args.contentHash, ctx.fingerprint)
      await recordTemplateEnrichmentFailure(payload, { templateId: args.templateId, contentHash: args.contentHash, reason, key, now: args.now })
    } catch (recordErr) {
      payload.logger.error({ err: recordErr, msg: `Could not record the enrichment failure of template ${args.templateId}` })
    }
    return { status: 'failed', reason, revalidateTags: [] }
  }
}

async function settleTemplateMessage(payload: Payload, ctx: EnrichContext, args: SettleArgs): Promise<Settled> {
  const key = failureKey(args.contentHash, ctx.fingerprint)
  const fail = async (reason: string): Promise<Settled> => {
    await recordTemplateEnrichmentFailure(payload, { templateId: args.templateId, contentHash: args.contentHash, reason, key, now: args.now })
    return { status: 'failed', reason, revalidateTags: [] }
  }
  const read = interpretMessage(args.message)
  if (!read.ok) return fail(read.reason)
  const valid = validateEnrichment(read.json, {
    leafSlugs: new Set(ctx.leaves.map((l) => l.slug)),
    tags: ctx.tags,
    maxNewTags: ctx.settings.maxNewTagsPerPlugin,
  })
  if (!valid.ok) return fail(valid.error)
  const applied = await applyTemplateEnrichment(payload, ctx, {
    templateId: args.templateId,
    contentHash: args.contentHash,
    fingerprint: ctx.fingerprint,
    model: args.message.model,
    result: valid.value,
    now: args.now,
  })
  return { status: applied.status, revalidateTags: applied.revalidateTags }
}

export type ApplyTemplateArgs = { templateId: number; contentHash: string | null; fingerprint: string; model: string; result: CleanEnrichment; now: Date }
export type ApplyTemplateResult = { status: 'applied' | 'stale' | 'missing' | 'disabled'; revalidateTags: string[]; createdTags: string[] }

/**
 * Writes one validated template enrichment, like applyEnrichment: kill switch and template re-read right before
 * writing, locks respected, an answer for older content dropped. Writes only `ai`, `category` and `_h_tags`.
 */
export async function applyTemplateEnrichment(payload: Payload, ctx: EnrichContext, args: ApplyTemplateArgs): Promise<ApplyTemplateResult> {
  const none = { revalidateTags: [] as string[], createdTags: [] as string[] }
  if (!(await loadSettings(payload)).enabled) return { status: 'disabled', ...none }
  const template = await findActiveTemplate(payload, args.templateId)
  if (!template) return { status: 'missing', ...none }
  if ((template.contentHash ?? null) !== args.contentHash) return { status: 'stale', ...none }

  const locks = template.locks ?? {}
  const { result } = args
  const data: Partial<Template> = {}
  const createdTags: string[] = []
  const oldCategory = typeof template.category === 'object' && template.category ? template.category.slug : null
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
    for (const id of aliasTagIds(toTemplateInput(template).topics, ctx.tags)) tagIds.add(id)
    data._h_tags = await existingTagIds(payload, tagIds)
  }

  data.ai = {
    ...(template.ai ?? {}),
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

  await payload.update({ collection: 'templates', id: template.id, ...write(), data })
  const tags = templateRevalidationTagsFor([template.slug])
  for (const slug of new Set([oldCategory, newCategory])) if (slug) tags.push(templateCategoryTag(slug))
  return { status: 'applied', revalidateTags: tags, createdTags }
}

/** As recordEnrichmentFailure: nothing when AI is off or the template's content changed since the request was built. */
export async function recordTemplateEnrichmentFailure(
  payload: Payload,
  args: { templateId: number; contentHash: string | null; reason: string; key: string; now: Date },
): Promise<void> {
  if (!(await loadSettings(payload)).enabled) return
  const template = await findActiveTemplate(payload, args.templateId)
  if (!template || (template.contentHash ?? null) !== args.contentHash) return
  await payload.update({
    collection: 'templates',
    id: template.id,
    ...write(),
    data: { ai: { ...(template.ai ?? {}), failure: args.reason.slice(0, 200), failedAt: args.now.toISOString(), failedKey: args.key } },
  })
}

export type StaleTemplate = { id: number; slug: string; contentHash: string }

/** Templates whose stored result is missing or out of date (content or prompt), minus already-failed inputs. Official first, then newest. */
export async function findStaleTemplates(payload: Payload, fingerprint: string): Promise<StaleTemplate[]> {
  const res = await payload.find({
    collection: 'templates',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    sort: ['-isOfficial', '-createdAt'],
    where: { contentHash: { exists: true } },
    select: { slug: true, contentHash: true, ai: true, locks: true },
  })
  return res.docs.flatMap((t) => {
    if (!t.contentHash || allLocked(t.locks)) return []
    const current = t.ai?.enrichedHash === t.contentHash && t.ai?.promptHash === fingerprint
    if (current || t.ai?.failedKey === failureKey(t.contentHash, fingerprint)) return []
    return [{ id: t.id, slug: t.slug, contentHash: t.contentHash }]
  })
}

const pending: Where = {
  and: [{ completedAt: { exists: false } }, { or: [{ hasError: { equals: false } }, { hasError: { exists: false } }] }],
}

/** Template ids that already have an unfinished enrich-template job. */
async function queuedTemplateIds(payload: Payload): Promise<Set<number>> {
  if (!payload.config.jobs?.tasks?.some((t) => t.slug === 'enrich-template')) return new Set()
  const res = await payload.find({
    collection: 'payload-jobs',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    where: { and: [pending, { taskSlug: { equals: 'enrich-template' } }] },
  })
  return new Set(res.docs.map((j) => Number((j.input as { templateId?: unknown } | null)?.templateId)))
}

export type TemplateEnrichAllResult = {
  status: 'disabled' | 'no-api-key' | 'no-categories' | 'debounced' | 'nothing-stale' | 'direct'
  ids: number[]
}

/**
 * The template pass of the hourly enrich-all: stale templates become direct `enrich-template` jobs (at most
 * DIRECT_MAX per pass, and never more than the ENRICH_MAX_PER_PASS cost guard). Independent of the plugin batch
 * state; the taxonomy-edit debounce is shared with the plugin pass (lastTaxonomyEdit).
 */
export async function runTemplateEnrichAll(
  payload: Payload,
  client: EnrichClient | null,
  now: Date,
  opts: { force?: boolean } = {},
): Promise<TemplateEnrichAllResult> {
  const result = (status: TemplateEnrichAllResult['status'], ids: number[] = []): TemplateEnrichAllResult => ({ status, ids })
  const ctx = await loadTemplateEnrichContext(payload)
  if (!ctx.settings.enabled) return result('disabled')
  if (!client) return result('no-api-key')
  if (ctx.leaves.length === 0) return result('no-categories')
  if (!opts.force && (await lastTaxonomyEdit(payload)) > now.getTime() - DEBOUNCE_MS) return result('debounced')
  const queued = await queuedTemplateIds(payload)
  const stale = (await findStaleTemplates(payload, ctx.fingerprint)).filter((t) => !queued.has(t.id))
  if (stale.length === 0) return result('nothing-stale')
  const take = stale.slice(0, Math.min(DIRECT_MAX, maxPerPassFromEnv()))
  if (take.length < stale.length) payload.logger.warn(`Enriching ${take.length} of ${stale.length} stale templates this pass; the rest follow next pass.`)
  return result('direct', take.map((t) => t.id))
}
