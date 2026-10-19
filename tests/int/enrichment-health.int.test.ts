import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { getEnrichmentHealth } from '@/enrich/health'
import { recordJobFailure, recordJobSuccess } from '@/sync/jobStatus'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy, setAiSettings } from './helpers/taxonomy'

let payload: Payload

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('getEnrichmentHealth', () => {
  it('counts enriched, uncategorized, low-confidence and failed plugins and reports the last runs', async () => {
    const tax = await createTestTaxonomy(payload)
    await setAiSettings(payload, { model: 'claude-sonnet-5-5' })
    const repo = await createRepo(payload)
    const at = '2026-10-19T10:00:00.000Z'
    await createPlugin(payload, repo.id, { slug: 'good', category: tax.cloud.id, ai: { enrichedAt: at, confidence: 0.9 } })
    await createPlugin(payload, repo.id, { slug: 'unsure', category: tax.other.id, ai: { enrichedAt: at, confidence: 0.4 } })
    await createPlugin(payload, repo.id, { slug: 'refused', name: 'Refused', ai: { failure: 'refusal:cyber', failedAt: at } })
    await createPlugin(payload, repo.id, { slug: 'new' })
    await recordJobSuccess(payload, 'enrich-all', { status: 'batch', stale: 2 }, new Date(at))
    await recordJobFailure(payload, 'enrich', new Error('529 overloaded'), new Date(at))

    expect(await getEnrichmentHealth(payload)).toEqual({
      enabled: true,
      model: 'claude-sonnet-5-5',
      total: 4,
      enriched: 2,
      uncategorized: 2,
      lowConfidence: 1,
      failed: 1,
      recentFailures: [{ slug: 'refused', name: 'Refused', reason: 'refusal:cyber', failedAt: at }],
      lastRun: { status: 'batch', at },
      lastError: { at, message: '529 overloaded' },
    })
  })
})
