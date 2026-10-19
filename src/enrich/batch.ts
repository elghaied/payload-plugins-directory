import type { Payload, Where } from 'payload'
import { allLocked, failureKey, findActivePlugin, loadEnrichContext, toPluginInput } from './context'
import { settleMessage } from './enrichPlugin'
import { buildRequest } from './prompt'
import { addUsage, usageOf, ZERO_USAGE } from './response'
import type { BatchItem, EnrichClient, EnrichUsage } from './types'

/** At or above this many stale plugins, enrich-all uses the Message Batches API (spec §5.2: 50% cost). */
export const BATCH_MIN = 20
/** Direct jobs queued per enrich-all run (the enrich queue runs 2 at a time). */
export const DIRECT_MAX = 50
export const BATCH_MAX = 2_000
/** enrich-all waits this long after the last category/settings edit, so a burst of edits costs one re-pass. */
export const DEBOUNCE_MS = 30 * 60_000
export const BATCH_POLL_MS = 5 * 60_000
/** Cost guard: one enrich-all pass never takes more plugins than this (direct or batch). `ENRICH_MAX_PER_PASS` overrides. */
export const DEFAULT_MAX_PER_PASS = 500

export function maxPerPassFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.ENRICH_MAX_PER_PASS)
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_PER_PASS
}

const NO_API_KEY_WARNING = 'ANTHROPIC_API_KEY is not set: AI enrichment is skipped and plugins stay uncategorized.'

export type StalePlugin = { id: number; slug: string; contentHash: string }
export type EnrichBatchInput = { batchId: string; fingerprint: string; model: string; items: { id: number; contentHash: string }[] }
export type EnrichAllStatus =
  | 'disabled' | 'no-api-key' | 'no-categories' | 'debounced' | 'batch-in-flight' | 'nothing-stale' | 'direct' | 'batch'
export type EnrichAllResult = {
  status: EnrichAllStatus
  stale: number
  direct: number[]
  batch: EnrichBatchInput | null
  /** For the job_status details: no API key, or the pass was cut by the cost guard. */
  warning?: string
}
export type EnrichBatchResult = {
  status: 'processing' | 'done' | 'cancelled' | 'stale-prompt' | 'no-api-key'
  applied: number
  failed: number
  retryDirect: number[]
  revalidateTags: string[]
  usage: EnrichUsage
}

export const customIdFor = (id: number): string => `plugin-${id}`
export function idFromCustomId(customId: string): number | null {
  const m = /^plugin-(\d+)$/.exec(customId)
  return m ? Number(m[1]) : null
}

/** Plugins whose stored result is missing or out of date (content or prompt), minus already-failed inputs. */
export async function findStalePlugins(payload: Payload, fingerprint: string): Promise<StalePlugin[]> {
  const res = await payload.find({
    collection: 'plugins',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    sort: '-healthScore',
    where: { contentHash: { exists: true } },
    select: { slug: true, contentHash: true, ai: true, locks: true },
  })
  return res.docs.flatMap((p) => {
    if (!p.contentHash || allLocked(p.locks)) return []
    const current = p.ai?.enrichedHash === p.contentHash && p.ai?.promptHash === fingerprint
    if (current || p.ai?.failedKey === failureKey(p.contentHash, fingerprint)) return []
    return [{ id: p.id, slug: p.slug, contentHash: p.contentHash }]
  })
}

const pending: Where = {
  and: [{ completedAt: { exists: false } }, { or: [{ hasError: { equals: false } }, { hasError: { exists: false } }] }],
}

async function pendingJobs(payload: Payload, task: 'enrich' | 'enrich-batch') {
  // task_slug is a Postgres enum of the registered slugs: an unregistered slug cannot have jobs (and would not parse).
  if (!payload.config.jobs?.tasks?.some((t) => t.slug === task)) return []
  const res = await payload.find({
    collection: 'payload-jobs',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    where: { and: [pending, { taskSlug: { equals: task } }] },
  })
  return res.docs
}

async function lastTaxonomyEdit(payload: Payload): Promise<number> {
  const [latest, settings] = await Promise.all([
    payload.find({ collection: 'categories', overrideAccess: true, depth: 0, limit: 1, sort: '-updatedAt' }),
    payload.findGlobal({ slug: 'directory-settings', overrideAccess: true, depth: 0 }),
  ])
  return Math.max(Date.parse(latest.docs[0]?.updatedAt ?? '') || 0, Date.parse(settings.updatedAt ?? '') || 0)
}

/**
 * The hourly sweep (spec §5.1): new plugins, changed content, changed category tree / instructions / model.
 * Few stale plugins → direct jobs; many (first pass, tree edits) → one Message Batch (spec §5.2).
 */
export async function runEnrichAll(
  payload: Payload,
  client: EnrichClient | null,
  now: Date,
  opts: { force?: boolean; batchMin?: number; maxPerPass?: number } = {},
): Promise<EnrichAllResult> {
  const result = (status: EnrichAllStatus, extra: Partial<EnrichAllResult> = {}): EnrichAllResult => ({
    status, stale: 0, direct: [], batch: null, ...extra,
  })
  const ctx = await loadEnrichContext(payload)
  if (!ctx.settings.enabled) return result('disabled')
  if (!client) return result('no-api-key', { warning: NO_API_KEY_WARNING })
  if (ctx.leaves.length === 0) return result('no-categories')
  if (!opts.force && (await lastTaxonomyEdit(payload)) > now.getTime() - DEBOUNCE_MS) return result('debounced')
  if ((await pendingJobs(payload, 'enrich-batch')).length > 0) return result('batch-in-flight')

  const queued = new Set((await pendingJobs(payload, 'enrich')).map((j) => Number((j.input as { pluginId?: unknown } | null)?.pluginId)))
  const stale = (await findStalePlugins(payload, ctx.fingerprint)).filter((p) => !queued.has(p.id))
  if (stale.length === 0) return result('nothing-stale')
  const maxPerPass = opts.maxPerPass ?? maxPerPassFromEnv()
  const direct = stale.length < (opts.batchMin ?? BATCH_MIN)
  const cap = Math.min(maxPerPass, direct ? DIRECT_MAX : BATCH_MAX)
  const take = stale.slice(0, cap)
  const warning =
    take.length < stale.length
      ? `Enriching ${take.length} of ${stale.length} stale plugins this pass (max ${cap}); the rest follow next pass.`
      : undefined
  payload.logger.info({ msg: 'enrich-all', mode: direct ? 'direct' : 'batch', stale: stale.length, taken: take.length, cap })
  if (warning) payload.logger.warn(warning)
  if (direct) return result('direct', { stale: stale.length, direct: take.map((p) => p.id), warning })

  // One taxonomy snapshot (ctx) for every request of the batch: one shared, cacheable system prompt. Tags created
  // while the batch runs reach the prompt on the next pass (tags are not part of the fingerprint).
  const items: BatchItem[] = []
  const submitted: EnrichBatchInput['items'] = []
  for (const s of take) {
    const plugin = await findActivePlugin(payload, s.id)
    if (!plugin?.contentHash) continue
    items.push({
      custom_id: customIdFor(s.id),
      params: buildRequest({ model: ctx.settings.model, system: ctx.system, schema: ctx.schema }, toPluginInput(plugin)),
    })
    // The hash of the content actually sent: a result is applied only while the plugin still has it.
    submitted.push({ id: s.id, contentHash: plugin.contentHash })
  }
  if (items.length === 0) return result('nothing-stale')
  const info = await client.createBatch(items)
  return result('batch', {
    stale: stale.length,
    batch: { batchId: info.id, fingerprint: ctx.fingerprint, model: ctx.settings.model, items: submitted },
    warning,
  })
}

/** Best effort (ruling F10): used when enrich-batch gives up, so an abandoned batch stops running. Never throws. */
export async function cancelBatchQuietly(client: EnrichClient | null, batchId: string): Promise<boolean> {
  if (!client) return false
  try {
    await client.cancelBatch(batchId)
    return true
  } catch {
    return false
  }
}

/** Polls one batch and, once it has ended, applies its results (any order) — see the rules above. */
export async function runEnrichBatch(
  payload: Payload,
  client: EnrichClient | null,
  input: EnrichBatchInput,
  now: Date,
): Promise<EnrichBatchResult> {
  const out: EnrichBatchResult = { status: 'done', applied: 0, failed: 0, retryDirect: [], revalidateTags: [], usage: ZERO_USAGE }
  if (!client) return { ...out, status: 'no-api-key' }
  const ctx = await loadEnrichContext(payload)
  const info = await client.retrieveBatch(input.batchId)
  if (!ctx.settings.enabled || ctx.fingerprint !== input.fingerprint) {
    if (info.processing_status !== 'ended') await client.cancelBatch(input.batchId)
    return { ...out, status: ctx.settings.enabled ? 'stale-prompt' : 'cancelled' }
  }
  if (info.processing_status !== 'ended') return { ...out, status: 'processing' }

  const items = new Map(input.items.map((i) => [i.id, i]))
  const seen = new Set<number>()
  const tags = new Set<string>()
  for await (const entry of client.batchResults(input.batchId)) {
    const id = idFromCustomId(entry.custom_id)
    const item = id === null ? undefined : items.get(id)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    if (entry.result.type !== 'succeeded') {
      out.retryDirect.push(item.id)
      continue
    }
    const message = entry.result.message
    out.usage = addUsage(out.usage, usageOf(message))
    if (message.stop_reason === 'refusal') {
      out.retryDirect.push(item.id) // direct requests carry the server-side refusal fallback
      continue
    }
    const settled = await settleMessage(payload, ctx, { pluginId: item.id, contentHash: item.contentHash, message, now })
    if (settled.status === 'applied') out.applied++
    else if (settled.status === 'failed') out.failed++
    for (const t of settled.revalidateTags) tags.add(t)
  }
  for (const id of items.keys()) if (!seen.has(id)) out.retryDirect.push(id)
  out.revalidateTags = [...tags]
  return out
}
