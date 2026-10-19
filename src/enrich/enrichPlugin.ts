import type { Payload } from 'payload'
import { applyEnrichment, recordEnrichmentFailure } from './apply'
import { allLocked, failureKey, findActivePlugin, loadEnrichContext, toPluginInput, type EnrichContext } from './context'
import { buildRequest } from './prompt'
import { interpretMessage, usageOf, ZERO_USAGE } from './response'
import type { EnrichClient, EnrichMessage, EnrichUsage } from './types'
import { validateEnrichment } from './validate'

export type EnrichStatus = 'applied' | 'stale' | 'missing' | 'disabled' | 'no-api-key' | 'no-categories' | 'locked' | 'failed'
export type EnrichOutcome = { status: EnrichStatus; reason?: string; revalidateTags: string[]; usage: EnrichUsage; model?: string }
type Settled = { status: EnrichStatus; reason?: string; revalidateTags: string[] }

/**
 * One direct enrichment (spec §5). Skips — without calling the API — when AI is off, there is no key, the tree
 * has no leaves, the plugin is gone or every field is locked. API/transport errors propagate (Payload retries).
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
    buildRequest({ model: ctx.settings.model, system: ctx.system, schema: ctx.schema }, toPluginInput(plugin)),
  )
  const settled = await settleMessage(payload, ctx, { pluginId, contentHash, message, now: now() })
  return { ...settled, usage: usageOf(message), model: message.model }
}

/** Shared by direct requests and batch results: interpret → validate → apply, or record the failure. */
export async function settleMessage(
  payload: Payload,
  ctx: EnrichContext,
  args: { pluginId: number; contentHash: string | null; message: EnrichMessage; now: Date },
): Promise<Settled> {
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
