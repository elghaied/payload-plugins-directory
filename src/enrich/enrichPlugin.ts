import type { Payload } from 'payload'
import { applyEnrichment, recordEnrichmentFailure } from './apply'
import { allLocked, failureKey, findActivePlugin, loadEnrichContext, toPluginInput, type EnrichContext } from './context'
import { buildRequest, buildUserContent } from './prompt'
import { interpretMessage, usageOf, ZERO_USAGE } from './response'
import type { EnrichClient, EnrichMessage, EnrichUsage } from './types'
import { validateEnrichment } from './validate'

export type EnrichStatus = 'applied' | 'stale' | 'missing' | 'disabled' | 'no-api-key' | 'no-categories' | 'locked' | 'failed'
export type EnrichOutcome = { status: EnrichStatus; reason?: string; revalidateTags: string[]; usage: EnrichUsage; model?: string }
type Settled = { status: EnrichStatus; reason?: string; revalidateTags: string[] }

/**
 * One direct enrichment (spec §5). Skips — without calling the API — when AI is off, there is no key, the tree
 * has no leaves, the plugin is gone or every field is locked. API/transport errors from `createMessage` propagate
 * (Payload retries); once the (billed) answer is in, nothing propagates: see settleSafely.
 */
export async function runEnrich(payload: Payload, pluginId: number, client: EnrichClient | null, now: () => Date): Promise<EnrichOutcome> {
  const skip = (status: EnrichStatus): EnrichOutcome => ({ status, revalidateTags: [], usage: ZERO_USAGE })
  const ctx = await loadEnrichContext(payload)
  if (!ctx.settings.enabled) return skip('disabled')
  if (!client) return skip('no-api-key')
  if (ctx.leaves.length === 0) return skip('no-categories')
  const plugin = await findActivePlugin(payload, pluginId)
  if (!plugin) return skip('missing')
  if (allLocked(plugin.locks)) return skip('locked')

  const contentHash = plugin.contentHash ?? null
  const message = await client.createMessage(
    buildRequest({ model: ctx.settings.model, system: ctx.system, schema: ctx.schema }, buildUserContent(toPluginInput(plugin))),
  )
  const settled = await settleSafely(payload, ctx, { pluginId, contentHash, message, now: now() })
  return { ...settled, usage: usageOf(message), model: message.model }
}

type SettleArgs = { pluginId: number; contentHash: string | null; message: EnrichMessage; now: Date }

/**
 * settleMessage for an answer that has already been paid for. An unexpected error while applying it (a DB error, a
 * bug, a poison value) must not reach a job retry, which would call the API again, nor abort a batch collection,
 * which would leave the later items stale and resubmitted every hour. It is logged and recorded as a failure with the
 * failedKey, so neither enrich-all nor sync retries this input. If even that record fails, the item stays failed for
 * this run (a later pass may retry it; nothing loops within the run).
 */
export async function settleSafely(payload: Payload, ctx: EnrichContext, args: SettleArgs): Promise<Settled> {
  try {
    return await settleMessage(payload, ctx, args)
  } catch (err) {
    const reason = `apply-error:${err instanceof Error ? err.name : 'unknown'}`
    payload.logger.error({ err, msg: `Could not apply the AI enrichment of plugin ${args.pluginId}; recorded as ${reason}` })
    try {
      const key = failureKey(args.contentHash, ctx.fingerprint)
      await recordEnrichmentFailure(payload, { pluginId: args.pluginId, contentHash: args.contentHash, reason, key, now: args.now })
    } catch (recordErr) {
      payload.logger.error({ err: recordErr, msg: `Could not record the enrichment failure of plugin ${args.pluginId}` })
    }
    return { status: 'failed', reason, revalidateTags: [] }
  }
}

/** Shared by direct requests and batch results: interpret → validate → apply, or record the failure. */
export async function settleMessage(payload: Payload, ctx: EnrichContext, args: SettleArgs): Promise<Settled> {
  const key = failureKey(args.contentHash, ctx.fingerprint)
  const fail = async (reason: string): Promise<Settled> => {
    await recordEnrichmentFailure(payload, { pluginId: args.pluginId, contentHash: args.contentHash, reason, key, now: args.now })
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
  const applied = await applyEnrichment(payload, ctx, {
    pluginId: args.pluginId,
    contentHash: args.contentHash,
    fingerprint: ctx.fingerprint,
    model: args.message.model,
    result: valid.value,
    now: args.now,
  })
  return { status: applied.status, revalidateTags: applied.revalidateTags }
}
