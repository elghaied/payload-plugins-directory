import type { Payload } from 'payload'
import { QUEUES } from '@/sync/queues'
import { failureKey, loadEnrichContext } from './context'

/** One `enrich` job per plugin; the per-plugin concurrency key (supersedes) collapses duplicates that have not started. */
export async function queueEnrich(payload: Payload, ids: readonly number[]): Promise<number> {
  const unique = [...new Set(ids)]
  for (const pluginId of unique) {
    await payload.jobs.queue({ task: 'enrich', input: { pluginId }, queue: QUEUES.enrich, overrideAccess: true })
  }
  return unique.length
}

/**
 * Phase 1 hook (sync-repository `contentChanged`). Only plugins enriched before are re-enriched directly; never-enriched
 * plugins are picked up by the hourly enrich-all, which batches them (first pass via the Batches API, spec §5.2).
 * A plugin whose current input (content + prompt fingerprint) already failed is skipped, so a sync never re-bills a
 * known failure; runEnrich itself does not check this (batch refusals re-run directly must still run).
 */
export async function queueEnrichForChanged(payload: Payload, ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0
  const ctx = await loadEnrichContext(payload)
  if (!ctx.settings.enabled) return 0
  const res = await payload.find({
    collection: 'plugins',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    select: { contentHash: true, ai: { failedKey: true } },
    where: { and: [{ id: { in: [...ids] } }, { 'ai.enrichedAt': { exists: true } }] },
  })
  const retry = res.docs.filter((d) => d.ai?.failedKey !== failureKey(d.contentHash, ctx.fingerprint))
  return queueEnrich(payload, retry.map((d) => d.id))
}
