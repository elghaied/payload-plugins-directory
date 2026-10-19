import { and, eq, isNull, sql } from '@payloadcms/db-postgres/drizzle'
import { randomUUID } from 'node:crypto'
import type { Payload, Where } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import { TAXONOMY_EDITED_KEY } from '@/taxonomy/hooks'
import { isBatchNotFound, isDefiniteCreateFailure } from './client'
import { allLocked, failureKey, findActivePlugin, loadEnrichContext, toPluginInput } from './context'
import { settleSafely } from './enrichPlugin'
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

/**
 * Durable in-flight batch marker (controller ruling), one job_status row. Claimed atomically (insert-if-absent) as
 * `submitting` before the batch is created, then set to `submitted` + batchId. While it exists no other batch is
 * submitted, independent of payload-jobs (a crash between create and queueing the poller still blocks).
 */
export const INFLIGHT_KEY = 'enrich-batch-inflight'
/** Batches expire after 24 h; a marker older than this cannot belong to a running batch. */
export const INFLIGHT_MAX_MS = 25 * 3_600_000
/**
 * A `submitting` marker flagged `notCreated` (the API answered the create with an HTTP error, so no batch exists)
 * is cleared after this long if its immediate delete did not happen. Unflagged ones (unknown outcome) last 25 h.
 */
export const SUBMITTING_MAX_MS = 3_600_000

export type InflightMarker = {
  state: 'submitting' | 'submitted'
  at: string
  /** Unique per claim: later updates and deletes touch only this run's marker. */
  claim: string
  batchId?: string
  notCreated?: boolean
}

type InflightRow = { marker: InflightMarker; raw: unknown }

async function readInflightRow(payload: Payload): Promise<InflightRow | null> {
  const rows = await payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, INFLIGHT_KEY))
  if (!rows[0]) return null
  const raw: unknown = rows[0].details
  const d = raw as Partial<InflightMarker> | null
  // An unreadable row counts as older than 25 h, so enrich-all clears it with a warning.
  if (!d || (d.state !== 'submitting' && d.state !== 'submitted') || typeof d.at !== 'string') {
    return { marker: { state: 'submitting', at: new Date(0).toISOString(), claim: '' }, raw }
  }
  return {
    marker: {
      state: d.state,
      at: d.at,
      claim: typeof d.claim === 'string' ? d.claim : '',
      ...(typeof d.batchId === 'string' ? { batchId: d.batchId } : {}),
      ...(d.notCreated === true ? { notCreated: true } : {}),
    },
    raw,
  }
}

export async function readInflight(payload: Payload): Promise<InflightMarker | null> {
  return (await readInflightRow(payload))?.marker ?? null
}

const markerKey = eq(jobStatus.key, INFLIGHT_KEY)
const claimIs = (claim: string) => and(markerKey, sql`${jobStatus.details}->>'claim' = ${claim}`)

/** Insert-if-absent: true only for the one run that created the row. */
async function claimInflight(payload: Payload, marker: InflightMarker, now: Date): Promise<boolean> {
  const rows = await payload.db.drizzle
    .insert(jobStatus)
    .values({ key: INFLIGHT_KEY, details: marker, lastSuccessAt: now, updatedAt: now })
    .onConflictDoNothing({ target: jobStatus.key })
    .returning({ key: jobStatus.key })
  return rows.length === 1
}

async function updateClaim(payload: Payload, claim: string, marker: InflightMarker, now: Date): Promise<void> {
  await payload.db.drizzle.update(jobStatus).set({ details: marker, lastSuccessAt: now, updatedAt: now }).where(claimIs(claim))
}

async function deleteClaim(payload: Payload, claim: string): Promise<void> {
  await payload.db.drizzle.delete(jobStatus).where(claimIs(claim))
}

/** Deletes the marker only if it is still exactly the one observed, so two runs cannot both clear (and both claim). */
async function deleteObserved(payload: Payload, raw: unknown): Promise<boolean> {
  const cond = raw == null ? isNull(jobStatus.details) : sql`${jobStatus.details} = ${JSON.stringify(raw)}::jsonb`
  const rows = await payload.db.drizzle.delete(jobStatus).where(and(markerKey, cond)).returning({ key: jobStatus.key })
  return rows.length === 1
}

/**
 * Removes the marker of this batch (a single conditional DELETE; any other batch's marker stays).
 * Task 10 calls this when enrich-batch exhausts its retries, after cancelBatchQuietly.
 */
export async function clearInflight(payload: Payload, batchId: string): Promise<void> {
  await payload.db.drizzle.delete(jobStatus).where(and(markerKey, sql`${jobStatus.details}->>'batchId' = ${batchId}`))
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
  status: 'processing' | 'done' | 'cancelled' | 'stale-prompt' | 'not-found' | 'no-api-key'
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

/** Latest category create/update/delete or settings save (deletes leave no updatedAt: see markTaxonomyEdited). */
async function lastTaxonomyEdit(payload: Payload): Promise<number> {
  const [latest, settings, deleted] = await Promise.all([
    payload.find({ collection: 'categories', overrideAccess: true, depth: 0, limit: 1, sort: '-updatedAt' }),
    payload.findGlobal({ slug: 'directory-settings', overrideAccess: true, depth: 0 }),
    payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, TAXONOMY_EDITED_KEY)),
  ])
  return Math.max(
    Date.parse(latest.docs[0]?.updatedAt ?? '') || 0,
    Date.parse(settings.updatedAt ?? '') || 0,
    deleted[0]?.lastSuccessAt?.getTime() ?? 0,
  )
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
  const warn = (): Partial<EnrichAllResult> => (warnings.length ? { warning: warnings.join(' ') } : {})
  const ctx = await loadEnrichContext(payload)
  if (!ctx.settings.enabled) return result('disabled')
  if (!client) return result('no-api-key', { warning: NO_API_KEY_WARNING })
  if (ctx.leaves.length === 0) return result('no-categories')
  if (!opts.force && (await lastTaxonomyEdit(payload)) > now.getTime() - DEBOUNCE_MS) return result('debounced')
  const warnings: string[] = []
  const observed = await readInflightRow(payload)
  if (observed) {
    const { marker } = observed
    const age = now.getTime() - (Date.parse(marker.at) || 0)
    const notCreated = marker.state === 'submitting' && marker.notCreated === true && age > SUBMITTING_MAX_MS
    if (!notCreated && age < INFLIGHT_MAX_MS) return result('batch-in-flight')
    // Another run may be clearing the same marker: only the one whose conditional delete wins goes on.
    if (!(await deleteObserved(payload, observed.raw))) return result('batch-in-flight')
    const w = notCreated
      ? `Cleared an enrich batch marker left in 'submitting' since ${marker.at} after a create the API rejected.`
      : `Cleared an enrich batch marker older than 25 h (batch ${marker.batchId ?? 'unknown'}, ${marker.at}).`
    payload.logger.warn(w)
    warnings.push(w)
  }
  if ((await pendingJobs(payload, 'enrich-batch')).length > 0) return result('batch-in-flight')

  const queued = new Set((await pendingJobs(payload, 'enrich')).map((j) => Number((j.input as { pluginId?: unknown } | null)?.pluginId)))
  const stale = (await findStalePlugins(payload, ctx.fingerprint)).filter((p) => !queued.has(p.id))
  if (stale.length === 0) return result('nothing-stale', warn())
  const maxPerPass = opts.maxPerPass ?? maxPerPassFromEnv()
  const direct = stale.length < (opts.batchMin ?? BATCH_MIN)
  const cap = Math.min(maxPerPass, direct ? DIRECT_MAX : BATCH_MAX)
  const take = stale.slice(0, cap)
  if (take.length < stale.length) {
    const w = `Enriching ${take.length} of ${stale.length} stale plugins this pass (max ${cap}); the rest follow next pass.`
    payload.logger.warn(w)
    warnings.push(w)
  }
  payload.logger.info({ msg: 'enrich-all', mode: direct ? 'direct' : 'batch', stale: stale.length, taken: take.length, cap })
  if (direct) return result('direct', { stale: stale.length, direct: take.map((p) => p.id), ...warn() })

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
  if (items.length === 0) return result('nothing-stale', warn())
  // Claim the marker atomically before creating: of two overlapping runs only one gets here with a claim.
  const at = now.toISOString()
  const claim = randomUUID()
  if (!(await claimInflight(payload, { state: 'submitting', at, claim }, now))) return result('batch-in-flight', warn())
  let info: Awaited<ReturnType<EnrichClient['createBatch']>>
  try {
    info = await client.createBatch(items)
  } catch (err) {
    if (isDefiniteCreateFailure(err)) {
      // The API answered with an HTTP error: no batch exists. Flag first (cleared after 1 h if the delete fails).
      await updateClaim(payload, claim, { state: 'submitting', at, claim, notCreated: true }, now)
      await deleteClaim(payload, claim)
    }
    // Otherwise (connection lost, timeout, abort, anything else) the batch may exist: the marker stays for 25 h.
    throw err
  }
  await updateClaim(payload, claim, { state: 'submitted', at, claim, batchId: info.id }, now)
  return result('batch', {
    stale: stale.length,
    batch: { batchId: info.id, fingerprint: ctx.fingerprint, model: ctx.settings.model, items: submitted },
    ...warn(),
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
  let info: Awaited<ReturnType<EnrichClient['retrieveBatch']>>
  try {
    info = await client.retrieveBatch(input.batchId)
  } catch (err) {
    if (!isBatchNotFound(err)) throw err
    // Gone (deleted, or never ours): nothing to collect; its plugins stay stale for the next pass.
    await clearInflight(payload, input.batchId)
    return { ...out, status: 'not-found' }
  }
  if (!ctx.settings.enabled || ctx.fingerprint !== input.fingerprint) {
    if (info.processing_status !== 'ended') await client.cancelBatch(input.batchId)
    await clearInflight(payload, input.batchId)
    return { ...out, status: ctx.settings.enabled ? 'stale-prompt' : 'cancelled' }
  }
  if (info.processing_status !== 'ended') return { ...out, status: 'processing' }

  const items = new Map(input.items.map((i) => [i.id, i]))
  const seen = new Set<number>()
  const tags = new Set<string>()
  const retry = new Set<number>()
  for await (const entry of client.batchResults(input.batchId)) {
    const id = idFromCustomId(entry.custom_id)
    const item = id === null ? undefined : items.get(id)
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    if (entry.result.type !== 'succeeded') {
      retry.add(item.id)
      continue
    }
    const message = entry.result.message
    out.usage = addUsage(out.usage, usageOf(message))
    if (message.stop_reason === 'refusal') {
      retry.add(item.id) // direct requests carry the server-side refusal fallback
      continue
    }
    // Per item: an error applying one paid answer is recorded for that plugin and collection goes on.
    const settled = await settleSafely(payload, ctx, { pluginId: item.id, contentHash: item.contentHash, message, now })
    if (settled.status === 'applied') out.applied++
    else if (settled.status === 'failed') out.failed++
    for (const t of settled.revalidateTags) tags.add(t)
  }
  for (const id of items.keys()) if (!seen.has(id)) retry.add(id)
  // Submission order (highest health first), capped like a direct pass; the rest stay stale for the next enrich-all.
  out.retryDirect = input.items.filter((i) => retry.has(i.id)).slice(0, DIRECT_MAX).map((i) => i.id)
  out.revalidateTags = [...tags]
  await clearInflight(payload, input.batchId)
  return out
}
