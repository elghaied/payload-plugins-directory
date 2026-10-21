import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { runReindexSearch } from '@/cli/reindexSearch'
import { reindexSearch } from '@/lib/search/reindex'
import { runTaxonomyResync } from '@/lib/search/resync'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createPlugin, createRepo, searchDocsFor } from './helpers/directory'

let payload: Payload
let repoId: number

const resyncJobs = async () =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'search-resync' } }, sort: 'id' })).docs
/** Runs queued search-resync jobs only (other queued jobs, e.g. revalidate, stay queued). */
const runResync = () =>
  payload.jobs.run({ queue: 'default', overrideAccess: true, silent: true, where: { taskSlug: { equals: 'search-resync' } } })
const mkCat = (title: string, slug: string, parent?: number) =>
  payload.create({ collection: 'categories', overrideAccess: true, data: { title, slug, ...(parent ? { parent } : {}) } })
const mkTag = (title: string, slug: string) => payload.create({ collection: 'tags', overrideAccess: true, data: { title, slug } })
const row = async (collection: 'plugins' | 'categories' | 'tags', id: number) => (await searchDocsFor(payload, collection, id))[0]

beforeAll(async () => {
  payload = await getTestPayload()
})
beforeEach(async () => {
  // Failures are injected on purpose in some tests; their error logs are expected.
  vi.spyOn(payload.logger, 'error').mockImplementation((() => undefined) as never)
  await resetDatabase(payload)
  repoId = (await createRepo(payload)).id
})
afterEach(() => vi.restoreAllMocks())
afterAll(async () => resetDatabase(payload))

describe('taxonomy changes', () => {
  it('queues a job instead of fanning out inside the request; the job updates categoryText of its plugins', async () => {
    const cat = await mkCat('Auth', 'auth')
    const p = await createPlugin(payload, repoId, { slug: 'cat-rename', category: cat.id })
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { title: 'Authentication' } })
    expect((await row('plugins', p.id)).categoryText).toBe('Auth')
    expect(await resyncJobs()).toHaveLength(1)
    await runResync()
    expect((await row('plugins', p.id)).categoryText).toContain('Authentication')
    // The existing revalidate hook still ran.
    const revalidates = await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })
    expect(revalidates.docs.length).toBeGreaterThan(0)
  })

  it('does not queue a job when nothing the plugins embed changed', async () => {
    const cat = await mkCat('Auth', 'auth')
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { intro: 'New intro' } })
    expect(await resyncJobs()).toHaveLength(0)
  })

  it('renaming a parent refreshes descendant categories and the plugins in them', async () => {
    const parent = await mkCat('Storage', 'storage')
    const child = await mkCat('Cloud', 'cloud', parent.id)
    const grand = await mkCat('Buckets', 'buckets', child.id)
    const p = await createPlugin(payload, repoId, { slug: 'in-grandchild', category: grand.id })
    expect((await row('plugins', p.id)).categoryText).toContain('Storage')
    await payload.update({ collection: 'categories', id: parent.id, overrideAccess: true, data: { title: 'Media storage' } })
    await runResync()
    expect((await row('plugins', p.id)).categoryText).toContain('Media storage')
    expect((await row('categories', grand.id)).categoryText).toContain('Media storage')
    expect((await row('categories', child.id)).categoryText).toContain('Media storage')
  })

  it('moving a category under another refreshes the path of its plugins', async () => {
    const a = await mkCat('Alpha', 'alpha')
    const b = await mkCat('Beta', 'beta')
    const p = await createPlugin(payload, repoId, { slug: 'moved', category: b.id })
    await payload.update({ collection: 'categories', id: b.id, overrideAccess: true, data: { parent: a.id } })
    await runResync()
    const [r] = await searchDocsFor(payload, 'plugins', p.id)
    expect(r.categoryText).toContain('Alpha')
    expect((await row('categories', b.id)).path).toBe('alpha/beta')
  })

  it('a tag rename updates the tagsText of its plugins', async () => {
    const tag = await mkTag('Mail', 'mail')
    const p = await createPlugin(payload, repoId, { slug: 'tag-rename', _h_tags: [tag.id] })
    await payload.update({ collection: 'tags', id: tag.id, overrideAccess: true, data: { title: 'Email' } })
    await runResync()
    expect((await row('plugins', p.id)).tagsText).toBe('Email')
  })

  it('deleting a category clears categoryText on its plugins', async () => {
    const cat = await mkCat('Temp', 'temp')
    const p = await createPlugin(payload, repoId, { slug: 'cat-delete', category: cat.id })
    await payload.delete({ collection: 'categories', id: cat.id, overrideAccess: true })
    await runResync()
    expect((await row('plugins', p.id)).categoryText ?? null).toBeNull()
    expect(await searchDocsFor(payload, 'categories', cat.id)).toEqual([])
  })

  it('deleting a tag clears it from the tagsText of its plugins', async () => {
    const tag = await mkTag('Gone', 'gone')
    const p = await createPlugin(payload, repoId, { slug: 'tag-delete', _h_tags: [tag.id] })
    await payload.delete({ collection: 'tags', id: tag.id, overrideAccess: true })
    await runResync()
    expect((await row('plugins', p.id)).tagsText ?? null).toBeNull()
  })

  it('a second edit of the same category syncs again (the synced-doc key is forgotten)', async () => {
    const cat = await mkCat('One', 'one')
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { title: 'Two' } })
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { title: 'Three' } })
    expect((await row('categories', cat.id)).title).toBe('Three')
  })

  it('continues in a follow-up job when the fan-out exceeds the per-job cap', async () => {
    const cat = await mkCat('Big', 'big')
    const ids: number[] = []
    for (let i = 0; i < 5; i++) ids.push((await createPlugin(payload, repoId, { slug: `big-${i}`, category: cat.id })).id)
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { title: 'Bigger' } })
    const queued: unknown[] = []
    const first = await runTaxonomyResync(payload, { collection: 'categories', id: cat.id }, async (n) => void queued.push(n), { batch: 2, cap: 2 })
    expect(first.continued).toBe(true)
    expect(queued).toEqual([{ collection: 'categories', id: cat.id, afterId: ids[1] }])
    const second = await runTaxonomyResync(payload, queued[0] as never, async (n) => void queued.push(n), { batch: 2, cap: 2 })
    expect(second.continued).toBe(true)
    const third = await runTaxonomyResync(payload, queued[1] as never, async (n) => void queued.push(n), { batch: 2, cap: 2 })
    expect(third).toMatchObject({ continued: false, synced: 1 })
    for (const id of ids) expect((await row('plugins', id)).categoryText).toContain('Bigger')
  })
})

describe('reindexSearch', () => {
  it('rebuilds the index from scratch, skipping hidden plugins and dropping stale and orphan records', async () => {
    const cat = await mkCat('Cat', 'cat')
    await mkTag('Tag', 'tag')
    await createPlugin(payload, repoId, { slug: 'visible' })
    const hidden = await createPlugin(payload, repoId, { slug: 'reindex-hidden', visibility: 'hidden' })
    // A stale record for a hidden plugin, as left behind by a write that bypassed hooks.
    await payload.create({
      collection: 'search',
      overrideAccess: true,
      data: { doc: { relationTo: 'plugins', value: hidden.id }, kind: 'plugin', slug: 'reindex-hidden', title: 'stale' },
    })
    // An orphan: the plugin is removed behind Payload's back, the FK cascade drops the relation and the row stays.
    const doomed = await createPlugin(payload, repoId, { slug: 'doomed' })
    await payload.db.drizzle.execute(sql`delete from plugins where id = ${doomed.id}`)
    const stale = await payload.count({ collection: 'search', overrideAccess: true, where: { slug: { equals: 'doomed' } } })
    expect(stale.totalDocs).toBe(1)
    await payload.delete({ collection: 'search', overrideAccess: true, where: { kind: { equals: 'category' } } })
    const result = await reindexSearch(payload)
    expect(result).toMatchObject({ skipped: false, failed: 0 })
    expect(result.removed).toBe(2) // the hidden plugin's stale row, and the orphan
    expect(await searchDocsFor(payload, 'plugins', hidden.id)).toEqual([])
    expect(await searchDocsFor(payload, 'categories', cat.id)).toHaveLength(1)
    const total = await payload.count({ collection: 'search', overrideAccess: true })
    const listed = await payload.count({ collection: 'plugins', overrideAccess: true, where: { visibility: { equals: 'listed' } } })
    const cats = await payload.count({ collection: 'categories', overrideAccess: true })
    const tags = await payload.count({ collection: 'tags', overrideAccess: true })
    expect(total.totalDocs).toBe(listed.totalDocs + cats.totalDocs + tags.totalDocs)
  })

  it('isolates failures per document, counts them and keeps the rest', async () => {
    const good = await createPlugin(payload, repoId, { slug: 'good' })
    const bad = await createPlugin(payload, repoId, { slug: 'bad' })
    await payload.delete({ collection: 'search', overrideAccess: true, where: { id: { exists: true } } })
    const { syncSearchDoc } = await import('@/lib/search/sync')
    const result = await reindexSearch(payload, {
      sync: async (p, c, id, req) => {
        if (id === bad.id && c === 'plugins') throw new Error('boom')
        return syncSearchDoc(p, c, id, req)
      },
    })
    expect(result).toMatchObject({ skipped: false, failed: 1, upserted: 1 })
    expect(await searchDocsFor(payload, 'plugins', good.id)).toHaveLength(1)
  })

  it('the CLI body throws when documents failed, so the exit code is non-zero', async () => {
    await createPlugin(payload, repoId, { slug: 'cli-ok' })
    expect((await runReindexSearch(payload, { ifIncomplete: false })).failed).toBe(0)
    await expect(
      runReindexSearch(payload, { ifIncomplete: false }, async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow(/failed/)
  })

  it('with ifIncomplete, skips when every source has its row', async () => {
    await mkCat('Done', 'done')
    await createPlugin(payload, repoId, { slug: 'indexed' })
    expect(await reindexSearch(payload, { ifIncomplete: true })).toEqual({ skipped: true, upserted: 0, removed: 0, failed: 0 })
  })

  it('with ifIncomplete, repairs an index that holds plugins but no categories or tags', async () => {
    const cat = await mkCat('Missing', 'missing')
    const tag = await mkTag('Absent', 'absent')
    const p = await createPlugin(payload, repoId, { slug: 'only-plugin' })
    await payload.delete({ collection: 'search', overrideAccess: true, where: { kind: { in: ['category', 'tag'] } } })
    expect((await payload.count({ collection: 'search', overrideAccess: true })).totalDocs).toBeGreaterThan(0)
    const result = await reindexSearch(payload, { ifIncomplete: true })
    expect(result).toMatchObject({ skipped: false, failed: 0 })
    expect(await searchDocsFor(payload, 'categories', cat.id)).toHaveLength(1)
    expect(await searchDocsFor(payload, 'tags', tag.id)).toHaveLength(1)
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
  })

  it('with ifIncomplete, builds an empty index', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'to-backfill' })
    await payload.delete({ collection: 'search', overrideAccess: true, where: { id: { exists: true } } })
    expect(await reindexSearch(payload, { ifIncomplete: true })).toMatchObject({ skipped: false, failed: 0 })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
  })

  it('keeps the row of a plugin that appeared while the run was going (outside the initial source list)', async () => {
    await createPlugin(payload, repoId, { slug: 'before' })
    let late: number | undefined
    await reindexSearch(payload, {
      sync: async (p, c, id, req) => {
        const { syncSearchDoc } = await import('@/lib/search/sync')
        if (!late) late = (await createPlugin(payload, repoId, { slug: 'created-mid-run' })).id
        return syncSearchDoc(p, c, id, req)
      },
    })
    expect(await searchDocsFor(payload, 'plugins', late!)).toHaveLength(1)
  })
})

describe('search-resync concurrency', () => {
  it('a burst of renames of one category leaves one pending fan-out job (older unstarted ones superseded)', async () => {
    const cat = await mkCat('Burst', 'burst')
    for (const title of ['B1', 'B2', 'B3']) {
      await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { title } })
    }
    expect(await resyncJobs()).toHaveLength(1)
  })

  it('delete slices of one taxonomy entry get distinct keys and are not superseded by a fresh edit', async () => {
    const { resyncKey } = await import('@/lib/search/resync')
    const edit = resyncKey({ collection: 'categories', id: 5 })
    expect(resyncKey({ collection: 'categories', id: 5, pluginIds: [1, 2] })).not.toBe(edit)
    expect(resyncKey({ collection: 'categories', id: 5, pluginIds: [3, 4] })).not.toBe(resyncKey({ collection: 'categories', id: 5, pluginIds: [1, 2] }))
    expect(resyncKey({ collection: 'categories', id: 5, afterId: 9 })).not.toBe(edit)
  })

  it('queues no empty continuation when the fan-out ends exactly at the cap', async () => {
    const cat = await mkCat('Exact', 'exact')
    for (let i = 0; i < 4; i++) await createPlugin(payload, repoId, { slug: `exact-${i}`, category: cat.id })
    const queued: unknown[] = []
    const r = await runTaxonomyResync(payload, { collection: 'categories', id: cat.id }, async (n) => void queued.push(n), { batch: 2, cap: 4 })
    expect(r.continued).toBe(false)
    expect(queued).toEqual([])
  })

  it('syncs that all find no row before any of them creates leave one row (forced worst interleaving)', async () => {
    const { syncSearchDoc } = await import('@/lib/search/sync')
    for (let round = 0; round < 5; round++) {
      const p = await createPlugin(payload, repoId, { slug: `racy-${round}` })
      await payload.delete({ collection: 'search', overrideAccess: true, where: { id: { exists: true } } })
      const N = 4
      // Hold every `search` create at a barrier until all N syncs have already read "no row", then release them together.
      let arrived = 0
      let release!: () => void
      const gate = new Promise<void>((resolve) => (release = resolve))
      const realCreate = payload.create.bind(payload)
      const spy = vi.spyOn(payload, 'create').mockImplementation((async (args: { collection: string }) => {
        if (args.collection === 'search') {
          if (++arrived === N) release()
          await gate
        }
        return realCreate(args as never)
      }) as never)
      try {
        await Promise.all(Array.from({ length: N }, () => syncSearchDoc(payload, 'plugins', p.id)))
      } finally {
        spy.mockRestore()
      }
      expect(arrived).toBe(N)
      expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
    }
  })
})
