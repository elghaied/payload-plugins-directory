import type { Payload } from 'payload'
import { QUEUES } from '@/sync/queues'
import { loadSettings } from './context'

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
 */
export async function queueEnrichForChanged(payload: Payload, ids: readonly number[]): Promise<number> {
  if (ids.length === 0 || !(await loadSettings(payload)).enabled) return 0
  const res = await payload.find({
    collection: 'plugins',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    select: { slug: true },
    where: { and: [{ id: { in: [...ids] } }, { 'ai.enrichedAt': { exists: true } }] },
  })
  return queueEnrich(payload, res.docs.map((d) => d.id))
}
