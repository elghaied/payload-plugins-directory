import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPayloadRequest, Forbidden, handleEndpoints, type Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { SEARCH_FIELD_LIMITS } from '@/lib/search/searchDoc'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createPlugin, createRepo, searchDocsFor, trashPlugin } from './helpers/directory'

let payload: Payload
let repoId: number

const revalidates = async () =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })).docs.length

beforeAll(async () => {
  payload = await getTestPayload()
})
beforeEach(async () => {
  await resetDatabase(payload)
  repoId = (await createRepo(payload)).id
})
afterAll(async () => resetDatabase(payload))

describe('search index sync', () => {
  it('indexes a listed plugin with taxonomy, AI text and README', async () => {
    const cat = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Authentication', slug: 'auth' } })
    const tag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'OAuth', slug: 'oauth' } })
    const p = await createPlugin(payload, repoId, {
      slug: 'better-auth',
      name: 'Better Auth',
      description: 'Auth for Payload',
      readme: '# Better Auth\nSupports passkeys.',
      category: cat.id,
      _h_tags: [tag.id],
      ai: { tagline: 'Passwordless sign-in', summary: 'Adds magic links.' },
    })
    const docs = await searchDocsFor(payload, 'plugins', p.id)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ kind: 'plugin', slug: 'better-auth', title: 'Better Auth', tagline: 'Passwordless sign-in', tagsText: 'OAuth' })
    expect(docs[0].categoryText).toContain('Authentication')
    expect(docs[0].summary).toContain('magic links')
    expect(docs[0].readme).toContain('passkeys')
  })

  it('puts the full title path of a child category into categoryText, and its slug path on the category row', async () => {
    const parent = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Storage & Media', slug: 'storage-media' } })
    const child = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Cloud storage', slug: 'cloud-storage', parent: parent.id } })
    const p = await createPlugin(payload, repoId, { slug: 's3-adapter', category: child.id })
    const [doc] = await searchDocsFor(payload, 'plugins', p.id)
    expect(doc.categoryText).toContain('Storage & Media')
    expect(doc.categoryText).toContain('Cloud storage')
    const [row] = await searchDocsFor(payload, 'categories', child.id)
    expect(row).toMatchObject({ kind: 'category', slug: 'cloud-storage', path: 'storage-media/cloud-storage' })
    expect(row.categoryText).toContain('Storage & Media')
  })

  it('writes no search row when a sync changes only fields that are not indexed (stars, downloads, health score)', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'stats-only', description: 'Stable text', readme: 'Same readme' })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
    const searchWrites = () => spy.mock.calls.filter(([a]) => (a as { collection?: string }).collection === 'search')
    const spy = vi.spyOn(payload, 'update')
    try {
      await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { healthScore: 42 } })
      expect(searchWrites()).toHaveLength(0)
      // An indexed field does reach the row.
      await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { description: 'Changed text' } })
      expect(searchWrites()).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
    expect((await searchDocsFor(payload, 'plugins', p.id))[0].summary).toContain('Changed text')
  })

  it('never indexes a plugin created hidden', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'hidden-at-birth', visibility: 'hidden' })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
  })

  it('removes the record when a system job hides a plugin (overrideAccess: true), and re-adds it on unhide', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'to-hide' })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { visibility: 'hidden' } })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { visibility: 'listed' } })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
  })

  it('removes the record on trash and recreates it on restore', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'to-trash' })
    await trashPlugin(payload, p.id)
    expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, trash: true, data: { deletedAt: null } })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
  })

  it('does not index a restored plugin that is still hidden', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'trashed-hidden', visibility: 'hidden' })
    await trashPlugin(payload, p.id)
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, trash: true, data: { deletedAt: null } })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
  })

  it('removes the record on hard delete', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'to-delete' })
    await payload.delete({ collection: 'plugins', id: p.id, overrideAccess: true })
    expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
  })

  it('indexes categories (with slug path) and tags (with aliases)', async () => {
    const cat = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Storage', slug: 'storage', intro: 'Files and media' } })
    const tag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'S3', slug: 's3', aliases: ['aws-s3'] } })
    expect((await searchDocsFor(payload, 'categories', cat.id))[0]).toMatchObject({ kind: 'category', slug: 'storage', path: 'storage', summary: 'Files and media' })
    expect((await searchDocsFor(payload, 'tags', tag.id))[0]).toMatchObject({ kind: 'tag', slug: 's3', tagsText: 'aws-s3' })
  })

  it('indexes a 100,000-character README clamped to the field limit', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'huge-readme', readme: 'passkeys '.repeat(12_500).slice(0, 100_000) })
    expect(String(p.readme)).toHaveLength(100_000)
    const [doc] = await searchDocsFor(payload, 'plugins', p.id)
    expect(doc).toBeDefined()
    expect(doc.readme).toHaveLength(SEARCH_FIELD_LIMITS.readme)
  })

  it('syncs a second change when two updates share one req', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'shared-req', name: 'First name' })
    const req = await createPayloadRequest({ payload, context: { skipRevalidate: true } })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, req, data: { name: 'Second name' } })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, req, data: { name: 'Third name' } })
    expect((await searchDocsFor(payload, 'plugins', p.id))[0].title).toBe('Third name')
  })

  it('still queues the revalidate job on a plugin update, and index writes add none of their own', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'revalidate-me' })
    expect(await revalidates()).toBe(0) // create + index insert with skipRevalidate: nothing queued
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { name: 'Renamed' } })
    expect(await revalidates()).toBe(1) // exactly the plugin hook's job; the search row update queued nothing
    expect((await searchDocsFor(payload, 'plugins', p.id))[0].title).toBe('Renamed')
  })

  describe('projected hook documents (write passes select)', () => {
    it('a system update with select keeps a listed plugin in the index and refreshes it', async () => {
      const p = await createPlugin(payload, repoId, { slug: 'select-system', name: 'Before' })
      await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, depth: 0, select: { name: true }, data: { name: 'After' } })
      const docs = await searchDocsFor(payload, 'plugins', p.id)
      expect(docs).toHaveLength(1)
      expect(docs[0].title).toBe('After')
    })

    it('a maintainer REST PATCH with ?select[customTagline]=true does not drop their plugin from the index', async () => {
      const m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 11, login: 'octo11' } })
      const p = await createPlugin(payload, repoId, { slug: 'select-rest', maintainers: [m.id] })
      const token = await signSessionToken({ maintainerId: m.id, githubId: 11 }, getSessionSecret())
      const res = await handleEndpoints({
        config: payload.config,
        request: new Request(`http://localhost/api/plugins/${p.id}?select[customTagline]=true`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}` },
          body: JSON.stringify({ customTagline: 'Via REST' }),
        }),
      })
      expect(res.status).toBe(200)
      const docs = await searchDocsFor(payload, 'plugins', p.id)
      expect(docs).toHaveLength(1)
      expect(docs[0].tagline).toBe('Via REST')
    })

    it('an update with trash: true and select on a trashed plugin does not create a row', async () => {
      const p = await createPlugin(payload, repoId, { slug: 'select-trashed' })
      await trashPlugin(payload, p.id)
      await payload.update({
        collection: 'plugins',
        id: p.id,
        overrideAccess: true,
        trash: true,
        depth: 0,
        select: { visibility: true, name: true, slug: true },
        data: { name: 'Renamed while trashed' },
      })
      expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
    })

    it('skipSearchSync leaves the index untouched', async () => {
      const p = await createPlugin(payload, repoId, { slug: 'no-sync', visibility: 'hidden' })
      await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, context: { skipSearchSync: true, skipRevalidate: true }, data: { visibility: 'listed' } })
      expect(await searchDocsFor(payload, 'plugins', p.id)).toEqual([])
    })
  })

  it('anonymous users cannot read the search collection', async () => {
    await expect(payload.find({ collection: 'search', overrideAccess: false, user: null })).rejects.toThrow(Forbidden)
  })

  it('over REST: anonymous read and write are refused, and so is a maintainer session', async () => {
    const p = await createPlugin(payload, repoId, { slug: 'rest-probe' })
    const [row] = await searchDocsFor(payload, 'plugins', p.id)
    const maintainer = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 7, login: 'octo' } })
    const token = await signSessionToken({ maintainerId: maintainer.id, githubId: 7 }, getSessionSecret())
    const call = async (method: string, path: string, cookie?: string, body?: unknown) =>
      (
        await handleEndpoints({
          config: payload.config,
          request: new Request(`http://localhost/api/search${path}`, {
            method,
            headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
            body: body === undefined ? undefined : JSON.stringify(body),
          }),
        })
      ).status
    for (const cookie of [undefined, `${SESSION_COOKIE}=${token}`]) {
      expect([401, 403]).toContain(await call('GET', '', cookie))
      expect([401, 403]).toContain(await call('GET', `/${row.id}`, cookie))
      expect([401, 403]).toContain(await call('POST', '', cookie, { title: 'x', kind: 'tag', slug: 'x' }))
      expect([401, 403]).toContain(await call('PATCH', `/${row.id}`, cookie, { title: 'x' }))
      expect([401, 403]).toContain(await call('DELETE', `/${row.id}`, cookie))
    }
    expect(await searchDocsFor(payload, 'plugins', p.id)).toHaveLength(1)
  })

  it('has a stored generated fts column with a GIN index', async () => {
    const col = await payload.db.drizzle.execute(
      sql`select attname, attgenerated from pg_attribute where attrelid = '"search"'::regclass and attname = 'fts'`,
    )
    expect(col.rows).toEqual([{ attname: 'fts', attgenerated: 's' }])
    const idx = await payload.db.drizzle.execute(sql`select indexdef from pg_indexes where tablename = 'search' and indexname = 'search_fts_idx'`)
    expect(String((idx.rows[0] as { indexdef?: string } | undefined)?.indexdef)).toContain('USING gin')
  })
})
