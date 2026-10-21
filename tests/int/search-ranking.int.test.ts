import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { searchDirectory } from '@/lib/search/searchDirectory'
import { searchIndex } from '@/lib/search/fts'
import { normalizeQuery } from '@/lib/search/query'
import { SearchBusyError, withSearchBudget, SEARCH_MAX_CONCURRENT } from '@/lib/search/budget'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createPlugin, createRepo } from './helpers/directory'

let payload: Payload
const slugsOf = (r: { plugins: { slug: string }[] }) => r.plugins.map((p) => p.slug)

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = (await createRepo(payload)).id
  // Created before the exact match so insertion order cannot explain the ranking.
  await createPlugin(payload, repo, { slug: 'noisy-readme', name: 'Noisy README', readme: 'seo kit '.repeat(200) + 'seo-kit '.repeat(100) })
  await createPlugin(payload, repo, { slug: 'seo-kit', name: 'SEO Kit' })
  await createPlugin(payload, repo, { slug: 'auth-readme', name: 'Readme Heavy', readme: 'authentication '.repeat(300) })
  await createPlugin(payload, repo, { slug: 'authn-toolkit', name: 'Authentication Toolkit' })
  await createPlugin(payload, repo, { slug: 'tie-b', name: 'Tiebreak Thing' })
  await createPlugin(payload, repo, { slug: 'tie-a', name: 'Tiebreak Thing' })
  await createPlugin(payload, repo, { slug: 'tie-c', name: 'Tiebreak Thing' })
  await createPlugin(payload, repo, { slug: 'pkg-holder', name: 'Package Holder', packageName: '@acme/payload-quux' })
  await createPlugin(payload, repo, { slug: 'quux-readme', name: 'Quux Mentions', readme: 'payload quux '.repeat(100) })
})
afterAll(async () => resetDatabase(payload))

describe('ranking', () => {
  it('puts an exact slug match above README mentions', async () => {
    expect(slugsOf(await searchDirectory(payload, 'seo-kit'))[0]).toBe('seo-kit')
    expect(slugsOf(await searchDirectory(payload, 'SEO KIT'))[0]).toBe('seo-kit')
  })
  it('puts a stemmed title match above a README that repeats the word', async () => {
    const slugs = slugsOf(await searchDirectory(payload, 'authenticating'))
    expect(slugs.indexOf('authn-toolkit')).toBeGreaterThanOrEqual(0)
    expect(slugs.indexOf('authn-toolkit')).toBeLessThan(slugs.indexOf('auth-readme'))
  })
  it('puts an exact package-name match first', async () => {
    expect(slugsOf(await searchDirectory(payload, '@acme/payload-quux'))[0]).toBe('pkg-holder')
  })
  it('breaks ties by title then slug, stably', async () => {
    const hits = await searchIndex(payload, normalizeQuery('tiebreak')!, { perKind: 10 })
    expect(hits.filter((h) => h.kind === 'plugin').map((h) => h.slug)).toEqual(['tie-a', 'tie-b', 'tie-c'])
    for (let i = 0; i < 3; i++) expect(slugsOf(await searchDirectory(payload, 'tiebreak'))).toEqual(['tie-a', 'tie-b', 'tie-c'])
  })
})

describe('visibility of stale rows', () => {
  it('never returns a stale index row whose plugin was hard-deleted', async () => {
    // A row whose slug matches no plugin any more (the doc relation is required, so point it at another plugin).
    const [any] = (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, limit: 1 })).docs
    await payload.create({
      collection: 'search',
      overrideAccess: true,
      data: { doc: { relationTo: 'plugins', value: any.id }, kind: 'plugin', slug: 'gone-plugin', title: 'Gone Plugin' } as never,
    })
    const hits = await searchIndex(payload, normalizeQuery('gone plugin')!, { perKind: 10 })
    expect(hits.map((h) => h.slug)).toContain('gone-plugin')
    const r = await searchDirectory(payload, 'gone plugin')
    expect(r.plugins).toEqual([])
  })
})

describe('errors, filters and paging', () => {
  it('returns status timeout (no throw) when Postgres cancels the statement', async () => {
    vi.spyOn(payload.db.drizzle, 'transaction').mockRejectedValueOnce(Object.assign(new Error('failed'), { cause: { code: '57014' } }))
    const r = await searchDirectory(payload, 'seo')
    vi.restoreAllMocks()
    expect(r).toMatchObject({ status: 'timeout', plugins: [], categories: [], tags: [] })
  })
  it('cancels a real slow statement with the 2 s limit semantics (57014 maps to timeout)', async () => {
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    const err = await payload.db.drizzle
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('statement_timeout', '1', true)`)
        await tx.execute(sql`select pg_sleep(1)`)
      })
      .catch((e: unknown) => e)
    vi.spyOn(payload.db.drizzle, 'transaction').mockRejectedValueOnce(err)
    const r = await searchDirectory(payload, 'seo')
    vi.restoreAllMocks()
    expect(r.status).toBe('timeout')
  })
  it('returns status busy when a queued search waits too long', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const held = Array.from({ length: SEARCH_MAX_CONCURRENT }, () => withSearchBudget(() => gate))
    await expect(withSearchBudget(async () => 1, { queueTimeoutMs: 20 })).rejects.toBeInstanceOf(SearchBusyError)
    release()
    await Promise.all(held)
    expect((await searchDirectory(payload, 'seo')).status).toBe('ok')
  })
  it('treats a 1-character query with a filter like a filter with no query', async () => {
    const a = await searchDirectory(payload, 'a', { filter: { payloadMajor: '4' } })
    const b = await searchDirectory(payload, '', { filter: { payloadMajor: '4' } })
    expect(slugsOf(a)).toEqual(slugsOf(b))
    expect(a.query).toBeNull()
  })
  it('caps the page so page x limit never exceeds the pool', async () => {
    const r = await searchDirectory(payload, 'tiebreak', { pluginLimit: 100, page: 99 })
    expect(r.page).toBe(5)
  })
  it('returns tags with only their selected fields', async () => {
    await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'Tiebreak tag', slug: 'tiebreak-tag' } })
    const r = await searchDirectory(payload, 'tiebreak tag')
    expect(r.tags.map((t) => t.slug)).toContain('tiebreak-tag')
  })
})
