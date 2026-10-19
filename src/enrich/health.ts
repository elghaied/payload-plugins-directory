import type { Payload, Where } from 'payload'
import { inArray } from '@payloadcms/db-postgres/drizzle'
import { jobStatus } from '@/db/jobStatus'
import { loadSettings } from './context'
import { FAILED_WHERE, LOW_CONFIDENCE_WHERE, UNCATEGORIZED_WHERE } from './presets'

export type EnrichmentHealth = {
  enabled: boolean
  model: string
  total: number
  enriched: number
  uncategorized: number
  lowConfidence: number
  failed: number
  recentFailures: { slug: string; name: string; reason: string; failedAt: string }[]
  lastRun: { status: string | null; at: string | null }
  lastError: { at: string | null; message: string | null }
}

/**
 * Spec §9 "enrichment failures" signal plus the Low confidence / Uncategorized counts behind the presets.
 * System loader: called only by the admin-only dashboard widget (which checks the user); no endpoint exposes it.
 */
export async function getEnrichmentHealth(payload: Payload): Promise<EnrichmentHealth> {
  const count = async (where?: Where) => (await payload.count({ collection: 'plugins', overrideAccess: true, ...(where ? { where } : {}) })).totalDocs
  const [settings, total, enriched, uncategorized, lowConfidence, failed, failures, rows] = await Promise.all([
    loadSettings(payload),
    count(),
    count({ 'ai.enrichedAt': { exists: true } }),
    count(UNCATEGORIZED_WHERE),
    count(LOW_CONFIDENCE_WHERE),
    count(FAILED_WHERE),
    payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, limit: 5, sort: '-ai.failedAt', where: FAILED_WHERE, select: { slug: true, name: true, ai: true } }),
    payload.db.drizzle.select().from(jobStatus).where(inArray(jobStatus.key, ['enrich-all', 'enrich', 'enrich-batch'])),
  ])
  const allRun = rows.find((r) => r.key === 'enrich-all')
  const lastFailure = rows
    .filter((r) => r.key !== 'enrich-all' && r.lastFailureAt)
    .sort((a, b) => b.lastFailureAt!.getTime() - a.lastFailureAt!.getTime())[0]
  return {
    enabled: settings.enabled,
    model: settings.model,
    total,
    enriched,
    uncategorized,
    lowConfidence,
    failed,
    recentFailures: failures.docs.map((d) => ({ slug: d.slug, name: d.name, reason: d.ai?.failure ?? '', failedAt: d.ai?.failedAt ?? '' })),
    lastRun: {
      status: typeof allRun?.details?.status === 'string' ? allRun.details.status : null,
      at: allRun?.lastSuccessAt?.toISOString() ?? null,
    },
    lastError: { at: lastFailure?.lastFailureAt?.toISOString() ?? null, message: lastFailure?.lastError ?? null },
  }
}
