import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { recordEnrichmentFailure } from '@/enrich/apply'
import { runSyncRepository } from '@/sync/syncRepository'
import { applyAliasTagsToAll, seedTaxonomy } from '@/taxonomy/seed'
import { type FakeRoute } from '../helpers/fakeFetch'
import { ghRepo, json, npmRoutes, pkg, raw, repoById, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext, syncFetch } from './helpers/syncContext'
import { createTestTaxonomy, setAiSettings } from './helpers/taxonomy'

/**
 * Payload v4 keeps the caller's `context` object (it does not copy it) and hooks write into it (plugin-search records
 * synced documents there). A context object shared between writes would therefore carry state from one write into
 * the next, so every system write passes a fresh one.
 */
let payload: Payload
type Call = { collection?: string; context?: Record<string, unknown> }

/** Records the `context` of every write while still running it. */
function recordWrites(): Call[] {
  const calls: Call[] = []
  for (const method of ['create', 'update'] as const) {
    const original = payload[method].bind(payload) as (args: Call) => Promise<unknown>
    vi.spyOn(payload, method).mockImplementation(((args: Call) => {
      calls.push({ collection: args.collection, context: args.context })
      return original(args)
    }) as never)
  }
  return calls
}
const contexts = (calls: Call[], collections: string[]) =>
  calls.filter((c) => c.collection && collections.includes(c.collection)).map((c) => c.context)
const allDistinct = (list: unknown[]) => new Set(list).size === list.length

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => resetDatabase(payload))

describe('system writes never share a context object', () => {
  it('seeding: each write and each run gets its own context, still skipping revalidation', async () => {
    const calls = recordWrites()
    await seedTaxonomy(payload)
    const first = contexts(calls, ['categories', 'tags'])
    expect(first.length).toBeGreaterThan(2)
    expect(allDistinct(first)).toBe(true)
    first.forEach((c) => expect(c).toMatchObject({ skipRevalidate: true }))

    const repo = await createRepo(payload, { topics: ['aws-s3'] })
    await createPlugin(payload, repo.id, { slug: 'a', keywords: ['stripe'] })
    await createPlugin(payload, repo.id, { slug: 'b', keywords: ['stripe'] })
    calls.length = 0
    expect((await applyAliasTagsToAll(payload)).updated).toEqual(['a', 'b'])
    const updates = contexts(calls, ['plugins'])
    expect(updates).toHaveLength(2)
    expect(allDistinct([...first, ...updates])).toBe(true)
    updates.forEach((c) => expect(c).toMatchObject({ skipRevalidate: true }))
  })

  it('enrichment: each write gets its own context and keeps the enrichment and skipRevalidate flags', async () => {
    await createTestTaxonomy(payload)
    await setAiSettings(payload, { enabled: true })
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'p', contentHash: 'h1' })
    const calls = recordWrites()
    const args = { pluginId: p.id, contentHash: 'h1', reason: 'x', key: 'k', now: new Date() }
    await recordEnrichmentFailure(payload, args)
    await recordEnrichmentFailure(payload, args)
    const writes = contexts(calls, ['plugins'])
    expect(writes).toHaveLength(2)
    expect(allDistinct(writes)).toBe(true)
    writes.forEach((c) => expect(c).toMatchObject({ enrichment: true, skipRevalidate: true }))
    // The enrichment flag still bypasses the AI-field locks (the write is not recorded as an admin edit).
    expect((await payload.findByID({ collection: 'plugins', id: p.id, overrideAccess: true, depth: 0 })).locks).toMatchObject({ summary: false })
  })

  it('repository sync: every write gets its own context, still skipping revalidation', async () => {
    const repo = ghRepo(7, 'acme/payload-seo', { pushed_at: '2026-10-18T09:00:00Z', topics: ['payload-plugin', 'seo'] })
    const routes = (readme: string): Record<string, FakeRoute> => ({
      [repoById(repo.id)]: json(repo),
      [raw(repo.full_name, 'package.json')]: pkg({ name: 'payload-seo', description: 'SEO tools', peerDependencies: { payload: '^3.0.0' } }),
      [raw(repo.full_name, 'README.md')]: text(readme),
      ...npmRoutes('payload-seo'),
    })
    const calls = recordWrites()
    const input = { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' as const }
    const now = new Date('2026-10-19T12:00:00Z')
    await runSyncRepository(payload, input, syncContext(syncFetch(routes('# One')), now))
    await runSyncRepository(payload, input, syncContext(syncFetch(routes('# Two')), now))
    const writes = contexts(calls, ['repositories', 'plugins'])
    expect(writes.length).toBeGreaterThanOrEqual(3)
    expect(allDistinct(writes)).toBe(true)
    writes.forEach((c) => expect(c).toMatchObject({ skipRevalidate: true }))
    const jobs = await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })
    expect(jobs.totalDocs).toBe(0)
  })
})

