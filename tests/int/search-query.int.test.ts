import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { toSummary } from '@/lib/directory/mappers'
import { searchDirectory } from '@/lib/search/searchDirectory'
import { searchIndex } from '@/lib/search/fts'
import { normalizeQuery } from '@/lib/search/query'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createPlugin, createRepo, trashPlugin } from './helpers/directory'

let payload: Payload
const slugsOf = (r: { plugins: { slug: string }[] }) => r.plugins.map((p) => p.slug)

const staleRow = (id: number, slug: string) =>
  payload.create({
    collection: 'search',
    overrideAccess: true,
    data: { doc: { relationTo: 'plugins', value: id }, kind: 'plugin', slug, title: slug.replace('-', ' ') } as never,
  })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = (await createRepo(payload)).id
  const auth = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Authentication', slug: 'auth' } })
  const oauth = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'OAuth', slug: 'oauth', parent: auth.id } })
  await createPlugin(payload, repo, { slug: 'seo-kit', name: 'SEO Kit', ai: { tagline: 'Meta tags and sitemaps' }, healthScore: 70 })
  await createPlugin(payload, repo, { slug: 'seo-next', name: 'SEO Next', payloadMajors: ['4'], healthScore: 60 })
  await createPlugin(payload, repo, { slug: 'passkey-auth', name: 'Passkey Auth', description: 'Authentication with passkeys', category: auth.id })
  await createPlugin(payload, repo, { slug: 'github-login', name: 'GitHub Login', category: oauth.id })
  await createPlugin(payload, repo, { slug: 'webhooks-relay', name: 'Webhooks Relay' })
  await createPlugin(payload, repo, { slug: 'storage-thing', name: 'Storage Thing', readme: 'This adapter supports webhooks for Cloudinary uploads.' })
  for (let i = 0; i < 5; i++) await createPlugin(payload, repo, { slug: `paged-${i}`, name: `Paged Thing ${i}`, healthScore: 50 - i })
  const hidden = await createPlugin(payload, repo, { slug: 'hidden-seo', name: 'Hidden SEO', visibility: 'hidden' })
  const trashed = await createPlugin(payload, repo, { slug: 'trashed-seo', name: 'Trashed SEO' })
  await trashPlugin(payload, trashed.id)
  // Stale index rows for the hidden and trashed plugins (as if a hook had been bypassed).
  await staleRow(hidden.id, 'hidden-seo')
  await staleRow(trashed.id, 'trashed-seo')
})
afterAll(async () => resetDatabase(payload))

describe('searchDirectory', () => {
  it('finds plugins by name and never returns hidden or trashed ones, even with stale index rows', async () => {
    const hits = await searchIndex(payload, normalizeQuery('seo')!, { perKind: 50 })
    expect(hits.map((h) => h.slug)).toEqual(expect.arrayContaining(['hidden-seo', 'trashed-seo'])) // the index does contain them
    expect(slugsOf(await searchDirectory(payload, 'seo')).sort()).toEqual(['seo-kit', 'seo-next'])
  })
  it('does not return a stale hidden row when a filter is active either', async () => {
    expect(slugsOf(await searchDirectory(payload, 'seo', { filter: { payloadMajor: '4' } }))).toEqual(['seo-next'])
  })
  it('ranks a name match above a README-only match', async () => {
    expect(slugsOf(await searchDirectory(payload, 'webhooks'))).toEqual(['webhooks-relay', 'storage-thing'])
  })
  it('matches README-only terms', async () => {
    expect(slugsOf(await searchDirectory(payload, 'cloudinary'))).toEqual(['storage-thing'])
  })
  it('stems and prefix-matches', async () => {
    expect(slugsOf(await searchDirectory(payload, 'authenticating'))).toContain('passkey-auth')
    expect(slugsOf(await searchDirectory(payload, 'passk'))).toContain('passkey-auth')
  })
  it('returns matching categories', async () => {
    expect((await searchDirectory(payload, 'authentication')).categories.map((c) => c.slug)).toContain('auth')
  })
  it('returns category paths for matching categories', async () => {
    const r = await searchDirectory(payload, 'oauth')
    expect(r.categories.find((c) => c.slug === 'oauth')?._h_slugPath).toBe('auth/oauth')
  })
  it('returns plugins that toSummary can map, including one in a child category', async () => {
    const r = await searchDirectory(payload, 'github')
    expect(slugsOf(r)).toEqual(['github-login'])
    expect(toSummary(r.plugins[0]).categoryPath).toBe('auth/oauth')
  })
  it('filters by Payload major', async () => {
    expect(slugsOf(await searchDirectory(payload, 'seo', { filter: { payloadMajor: '4' } }))).toEqual(['seo-next'])
  })
  it('filters by category including subcategories, with or without a query', async () => {
    expect(slugsOf(await searchDirectory(payload, '', { filter: { categorySlug: 'auth' } })).sort()).toEqual(['github-login', 'passkey-auth'])
    expect(slugsOf(await searchDirectory(payload, 'login', { filter: { categorySlug: 'auth' } }))).toEqual(['github-login'])
    expect(slugsOf(await searchDirectory(payload, '', { filter: { categorySlug: 'oauth' } }))).toEqual(['github-login'])
    expect(slugsOf(await searchDirectory(payload, 'passkey', { filter: { categorySlug: 'oauth' } }))).toEqual([])
  })
  it('lists a filter-only result with mappable plugins', async () => {
    const r = await searchDirectory(payload, '', { filter: { categorySlug: 'auth' } })
    expect(r.plugins.map((p) => toSummary(p).categoryPath).sort()).toEqual(['auth', 'auth/oauth'])
  })
  it('reports an unknown category instead of ignoring the filter', async () => {
    const r = await searchDirectory(payload, 'seo', { filter: { categorySlug: 'nope' } })
    expect(r.unknownCategory).toBe(true)
    expect(r.plugins).toEqual([])
  })
  it('returns nothing (no throw) for empty and whitespace queries', async () => {
    for (const q of ['', '   ', '\n']) {
      expect(await searchDirectory(payload, q)).toMatchObject({ query: null, plugins: [], categories: [], tags: [] })
    }
  })
  it('does not treat % or _ as wildcards', async () => {
    expect((await searchDirectory(payload, '%')).plugins).toEqual([])
    expect((await searchDirectory(payload, '_')).plugins).toEqual([])
    expect((await searchDirectory(payload, '%%')).plugins).toEqual([])
    expect((await searchDirectory(payload, '__')).plugins).toEqual([])
  })
  it('survives odd and hostile input', async () => {
    const odd = [`'"&|!:*()<>\\`, "'; drop table search; --", 'a'.repeat(10_000), '🙂🙂', 'the', 'NUL\u0000byte', 'a & | !b', '":*', 'a:*', 'ＳＥＯ', 'x'.repeat(5_000_000)]
    for (const q of odd) {
      const r = await searchDirectory(payload, q)
      expect(Array.isArray(r.plugins)).toBe(true)
    }
    expect((await payload.count({ collection: 'search', overrideAccess: true })).totalDocs).toBeGreaterThan(0)
  })
  it('matches full-width input like its plain spelling', async () => {
    expect(slugsOf(await searchDirectory(payload, 'ＳＥＯ')).sort()).toEqual(['seo-kit', 'seo-next'])
  })
})

describe('searchDirectory limits and cost', () => {
  it('makes no database call for blank or too-short queries', async () => {
    const tx = vi.spyOn(payload.db.drizzle, 'transaction')
    const find = vi.spyOn(payload, 'find')
    for (const q of ['', ' ', 'a', '🙂', undefined, 42]) await searchDirectory(payload, q)
    expect(tx).not.toHaveBeenCalled()
    expect(find).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })
  it('loads full documents (depth 1) only for the final page', async () => {
    const find = vi.spyOn(payload, 'find')
    const r = await searchDirectory(payload, 'paged', { pluginLimit: 2 })
    const depth1 = find.mock.calls.filter(([a]) => a.collection === 'plugins' && a.depth === 1)
    expect(depth1).toHaveLength(1)
    expect(r.plugins).toHaveLength(2)
    expect(r.hasMore).toBe(true)
    // The depth-1 read is restricted to the page's slugs.
    expect(JSON.stringify(depth1[0][0].where)).not.toContain('seo-kit')
    vi.restoreAllMocks()
  })
  it('pages through ranked results without overlap', async () => {
    const p1 = await searchDirectory(payload, 'paged', { pluginLimit: 3, page: 1 })
    const p2 = await searchDirectory(payload, 'paged', { pluginLimit: 3, page: 2 })
    expect(p1.plugins).toHaveLength(3)
    expect(p2.plugins).toHaveLength(2)
    expect(p2.hasMore).toBe(false)
    expect(new Set([...slugsOf(p1), ...slugsOf(p2)]).size).toBe(5)
  })
  it('caps the per-page limit and the page number', async () => {
    expect((await searchDirectory(payload, 'paged', { pluginLimit: 10_000 })).plugins).toHaveLength(5)
    const far = await searchDirectory(payload, 'paged', { page: 1e9, pluginLimit: 1 })
    expect(far.page).toBe(10)
    expect(far.plugins).toEqual([])
  })
  it('refuses work beyond the concurrency budget instead of queueing forever', async () => {
    const { withSearchBudget, SearchBusyError, SEARCH_MAX_CONCURRENT, SEARCH_MAX_QUEUED, searchBudgetState } = await import('@/lib/search/budget')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const held = Array.from({ length: SEARCH_MAX_CONCURRENT + SEARCH_MAX_QUEUED }, () => withSearchBudget(() => gate))
    await expect(withSearchBudget(async () => 1)).rejects.toBeInstanceOf(SearchBusyError)
    expect(searchBudgetState()).toEqual({ running: SEARCH_MAX_CONCURRENT, queued: SEARCH_MAX_QUEUED })
    release()
    await Promise.all(held)
    expect(searchBudgetState()).toEqual({ running: 0, queued: 0 })
  })
  it('applies a statement timeout inside the search transaction', async () => {
    const seen: string[] = []
    const { sql } = await import('@payloadcms/db-postgres/drizzle')
    const real = payload.db.drizzle.transaction.bind(payload.db.drizzle)
    type Fn = Parameters<typeof real>[0]
    vi.spyOn(payload.db.drizzle, 'transaction').mockImplementation(((fn: Fn) =>
      real(async (tx) => {
        const out = await fn(tx)
        seen.push(String((await tx.execute(sql`select current_setting('statement_timeout') as t`)).rows[0].t))
        return out
      })) as never)
    await searchDirectory(payload, 'seo')
    vi.restoreAllMocks()
    expect(seen).toEqual(['2s'])
  })
})

describe('toSiteResult', () => {
  it('maps hits to summaries with the display tagline and categories with their slug path', async () => {
    const { toSiteResult } = await import('@/lib/search/present')
    const view = toSiteResult(await searchDirectory(payload, 'seo kit'))!
    expect(view.status).toBe('ok')
    expect(view.query).toBe('seo kit')
    expect(view.plugins[0]).toMatchObject({ slug: 'seo-kit', name: 'SEO Kit', description: 'Meta tags and sitemaps' })
    const auth = toSiteResult(await searchDirectory(payload, 'oauth'))!
    expect(auth.categories.find((c) => c.slug === 'oauth')?.path).toBe('auth/oauth')
    // A categorised hit must not throw (toSummary needs _h_slugPath).
    const gh = toSiteResult(await searchDirectory(payload, 'github'))!
    expect(gh.plugins.find((p) => p.slug === 'github-login')?.categoryPath).toBe('auth/oauth')
  })
  it('is null for an empty query', async () => {
    const { toSiteResult } = await import('@/lib/search/present')
    expect(toSiteResult(await searchDirectory(payload, ''))).toBeNull()
  })
  it('passes timeout and busy statuses through', async () => {
    const { toSiteResult } = await import('@/lib/search/present')
    const q = { text: 'x', prefix: '', truncated: false }
    for (const status of ['timeout', 'busy'] as const) {
      expect(toSiteResult({ status, query: null, plugins: [], categories: [], tags: [], page: 1, hasMore: false })?.status).toBe(status)
      expect(toSiteResult({ status, query: q, plugins: [], categories: [], tags: [], page: 1, hasMore: false })?.status).toBe(status)
    }
  })
})
