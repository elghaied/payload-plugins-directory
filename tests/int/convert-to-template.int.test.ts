import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPayloadRequest, handleEndpoints, initTransaction, killTransaction, type Payload } from 'payload'
import { getSessionSecret, SESSION_COOKIE, signSessionToken } from '@/lib/auth/session'
import { listedPluginsWhere } from '@/collections/Plugins'
import { convertToTemplateEndpoint } from '@/endpoints/convertToTemplate'
import { convertPluginToTemplate } from '@/lib/templates/convert'
import { relationId } from '@/lib/relationId'
import { runSyncRepository } from '@/sync/syncRepository'
import { runSyncTemplate } from '@/sync/templates/syncTemplate'
import { fakeFetch } from '../helpers/fakeFetch'
import { API, ghRepo, json, pkg, RAW, raw, repoById, repoByName, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-21T12:00:00Z')
const GH = ghRepo(77, 'acme/starter', { topics: ['payload-plugin'], is_template: true })
const admin = { id: 1, collection: 'users' } as never

const listedPlugins = async () =>
  (await payload.find({ collection: 'plugins', overrideAccess: true, where: listedPluginsWhere, limit: 0, pagination: false, depth: 0 })).totalDocs
const jobsOf = async (taskSlug: string) =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: taskSlug } }, limit: 0, pagination: false })).docs
const pluginRow = async (slug: string) =>
  (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, depth: 0, where: { slug: { equals: slug } } })).docs[0]
const callEndpoint = async (user: unknown, id: number) => {
  const req = await createPayloadRequest({ payload, user: user as never })
  req.routeParams = { id: String(id) }
  return convertToTemplateEndpoint.handler(req)
}

let repoId: number
let pluginId: number
let maintainerId: number

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const tag = await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'SEO', slug: 'seo' } as never })
  const m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 9, login: 'octo' } })
  maintainerId = m.id
  repoId = (await createRepo(payload, { fullName: 'acme/starter', githubId: 77, url: 'https://github.com/acme/starter' })).id
  const p = await createPlugin(payload, repoId, {
    slug: '77-root', name: 'Starter', url: 'https://github.com/acme/starter', description: 'd', readme: '# hi',
    maintainers: [m.id], customTagline: 'Mine', _h_tags: [tag.id],
  } as never)
  pluginId = p.id
  await createPlugin(payload, (await createRepo(payload)).id, { slug: 'other-plugin' })
})
afterAll(async () => resetDatabase(payload))

describe('convertPluginToTemplate', () => {
  it('converts, trashes the plugin as an admin decision and queues jobs', async () => {
    const before = await listedPlugins()
    const req = await createPayloadRequest({ payload, user: admin })
    const r = await convertPluginToTemplate(payload, pluginId, req)
    expect(r).toEqual({ status: 'converted', templateSlug: '77-root' })

    const t = (await payload.find({ collection: 'templates', overrideAccess: true, depth: 0, where: { slug: { equals: '77-root' } } })).docs[0]
    expect(t).toMatchObject({ name: 'Starter', source: 'converted', isOfficial: false, contentHash: null, customTagline: 'Mine', visibility: 'listed', readme: '# hi' })
    expect((t.maintainers ?? []).map(relationId)).toEqual([maintainerId])
    expect(t._h_tags?.length).toBe(1)
    const plugin = await pluginRow('77-root')
    expect(plugin.deletedAt).toBeTruthy()
    expect(plugin.syncTrashReason ?? null).toBeNull()
    expect(await listedPlugins()).toBe(before - 1)

    const sync = (await jobsOf('sync-template')).filter((j) => (j.input as { fullName?: string }).fullName === 'acme/starter')
    expect(sync).toHaveLength(1)
    expect(sync[0].input).toMatchObject({ githubId: 77, source: 'converted' })
    const tags = (await jobsOf('revalidate')).flatMap((j) => (j.input as { tags: string[] }).tags)
    expect(tags).toEqual(expect.arrayContaining(['plugins', 'plugin:77-root', 'templates', 'template:77-root']))
  })

  it('returns exists for a second call, and missing for a trashed or unknown plugin', async () => {
    const req = await createPayloadRequest({ payload, user: admin })
    expect(await convertPluginToTemplate(payload, pluginId, req)).toEqual({ status: 'missing' })
    expect(await convertPluginToTemplate(payload, 999_999, req)).toEqual({ status: 'missing' })
    const dup = await createPlugin(payload, repoId, { slug: 'dup', name: 'Dup' })
    expect(await convertPluginToTemplate(payload, dup.id, req)).toEqual({ status: 'exists', templateSlug: '77-root' })
    expect((await pluginRow('dup')).deletedAt).toBeFalsy()
  })

  it('finds the same-path template in a multi-template repository (no duplicate)', async () => {
    const repo = await createRepo(payload)
    const mk = (slug: string, path: string | null) =>
      payload.create({ collection: 'templates', overrideAccess: true, context: { skipRevalidate: true }, data: { slug, name: slug, repository: repo.id, path, url: 'https://github.com/a/b', source: 'submission' } as never })
    await mk('multi-a', 'templates/a')
    await mk('multi-b', 'templates/b')
    await mk('multi-root', null)
    const req = await createPayloadRequest({ payload, user: admin })
    const sub = await createPlugin(payload, repo.id, { slug: 'multi-plugin-b', path: 'templates/b' })
    expect(await convertPluginToTemplate(payload, sub.id, req)).toEqual({ status: 'exists', templateSlug: 'multi-b' })
    const root = await createPlugin(payload, repo.id, { slug: 'multi-plugin-root' })
    expect(await convertPluginToTemplate(payload, root.id, req)).toEqual({ status: 'exists', templateSlug: 'multi-root' })
    expect((await pluginRow('multi-plugin-b')).deletedAt).toBeFalsy()
    expect((await pluginRow('multi-plugin-root')).deletedAt).toBeFalsy()
    expect((await payload.find({ collection: 'templates', overrideAccess: true, where: { repository: { equals: repo.id } }, limit: 0 })).totalDocs).toBe(3)
  })

  it('reports a trashed template holding the slug and leaves the plugin untouched', async () => {
    const repo = await createRepo(payload)
    await payload.create({
      collection: 'templates', overrideAccess: true, context: { skipRevalidate: true },
      data: { slug: 'slug-held', name: 'old', repository: repo.id, path: 'other', url: 'https://github.com/a/b', source: 'submission', deletedAt: new Date().toISOString() } as never,
    })
    const p = await createPlugin(payload, repo.id, { slug: 'slug-held' })
    const req = await createPayloadRequest({ payload, user: admin })
    expect(await convertPluginToTemplate(payload, p.id, req)).toEqual({ status: 'slug-taken', templateSlug: 'slug-held' })
    expect((await pluginRow('slug-held')).deletedAt).toBeFalsy()
    const res = await callEndpoint(admin, p.id)
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/Restore or delete/)
  })

  it('refuses official plugins (Ruling 13): status official, endpoint 400, nothing changes', async () => {
    const repo = await createRepo(payload)
    const byFlag = await createPlugin(payload, repo.id, { slug: 'official-flag', path: 'packages/a', isOfficial: true })
    const bySource = await createPlugin(payload, repo.id, { slug: 'official-source', path: 'packages/b', source: 'official' })
    const req = await createPayloadRequest({ payload, user: admin })
    expect(await convertPluginToTemplate(payload, byFlag.id, req)).toEqual({ status: 'official' })
    expect(await convertPluginToTemplate(payload, bySource.id, req)).toEqual({ status: 'official' })
    const res = await callEndpoint(admin, byFlag.id)
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Official plugins cannot be converted/)
    expect((await pluginRow('official-flag')).deletedAt).toBeFalsy()
    expect((await pluginRow('official-source')).deletedAt).toBeFalsy()
    expect((await payload.find({ collection: 'templates', overrideAccess: true, trash: true, where: { repository: { equals: repo.id } }, limit: 0 })).totalDocs).toBe(0)
  })

  it('propagates database errors instead of reporting missing', async () => {
    const req = await createPayloadRequest({ payload, user: admin })
    const spy = vi.spyOn(payload, 'findByID').mockRejectedValueOnce(new Error('connection lost'))
    await expect(convertPluginToTemplate(payload, pluginId, req)).rejects.toThrow('connection lost')
    spy.mockRestore()
  })

  it('rolls everything back when a step fails (one transaction)', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'rollback-me' })
    const req = await createPayloadRequest({ payload, user: admin })
    await initTransaction(req)
    await convertPluginToTemplate(payload, p.id, req)
    await killTransaction(req)
    expect((await pluginRow('rollback-me')).deletedAt).toBeFalsy()
    expect((await payload.find({ collection: 'templates', overrideAccess: true, where: { slug: { equals: 'rollback-me' } } })).totalDocs).toBe(0)
  })

  it('sync-repository neither restores nor recreates the plugin; sync-template accepts the converted input', async () => {
    const routes = {
      [repoById(77)]: json(GH), [repoByName('acme/starter')]: json(GH),
      [raw('acme/starter', 'package.json')]: pkg({ name: 'starter', description: 'A starter', dependencies: { payload: '^3.0.0', '@payloadcms/next': '^3.0.0' } }),
      [raw('acme/starter', 'README.md')]: text('# Starter'),
    }
    const ctx = syncContext(fakeFetch(routes, { notFoundPrefixes: [RAW, API] }), NOW)
    const r = await runSyncRepository(payload, { fullName: 'acme/starter', githubId: 77, source: 'topic' }, ctx)
    expect(r.created).toEqual([])
    const plugin = await pluginRow('77-root')
    expect(plugin.deletedAt).toBeTruthy()
    const total = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { repository: { equals: repoId } }, limit: 0 })
    expect(total.docs.map((d) => d.slug).sort()).toEqual(['77-root', 'dup']) // no recreated row (dup is not in the repo's extraction)

    const t = await runSyncTemplate(payload, { fullName: 'acme/starter', githubId: 77, path: null, source: 'converted' }, ctx)
    expect(t.status).not.toBe('conflict')
    expect(t.updated).toEqual(['77-root'])
    expect((await pluginRow('77-root')).deletedAt).toBeTruthy()
  })
})

describe('POST /api/plugins/:id/convert-to-template', () => {
  it('refuses a maintainer with 403 and converts nothing', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'endpoint-plugin' })
    const res = await callEndpoint({ id: maintainerId, collection: 'maintainers' }, p.id)
    expect(res.status).toBe(403)
    expect((await pluginRow('endpoint-plugin')).deletedAt).toBeFalsy()
    expect((await callEndpoint(null, p.id)).status).toBe(403)
    // Through the real REST route with a maintainer session cookie.
    const token = await signSessionToken({ maintainerId, githubId: 9 }, getSessionSecret())
    const rest = await handleEndpoints({
      config: payload.config,
      request: new Request(`http://localhost/api/plugins/${p.id}/convert-to-template`, { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${token}` } }),
    })
    expect(rest.status).toBe(403)
    expect((await pluginRow('endpoint-plugin')).deletedAt).toBeFalsy()
  })

  it('ignores a cookie-authenticated admin POST that carries a foreign Origin (CSRF)', async () => {
    const email = 'csrf-admin@example.test'
    const password = 'Csrf-admin-1234!'
    await payload.create({ collection: 'users', overrideAccess: true, data: { email, password } as never })
    const { token } = await payload.login({ collection: 'users', data: { email, password } })
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'csrf-plugin' })
    const post = (origin?: string) =>
      handleEndpoints({
        config: payload.config,
        request: new Request(`http://localhost/api/plugins/${p.id}/convert-to-template`, {
          method: 'POST',
          headers: { cookie: `payload-token=${token}`, ...(origin ? { origin } : {}) },
        }),
      })
    const foreign = await post('https://evil.example')
    expect(foreign.status).toBe(403)
    expect((await pluginRow('csrf-plugin')).deletedAt).toBeFalsy()
    expect((await post(payload.config.serverURL)).status).toBe(200) // control: the same cookie from the site's own origin works
  })

  it('converts for an admin, 404s for missing', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'endpoint-ok' })
    const res = await callEndpoint(admin, p.id)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ templateSlug: 'endpoint-ok', status: 'converted' })
    expect((await pluginRow('endpoint-ok')).deletedAt).toBeTruthy()
    expect((await callEndpoint(admin, 999_999)).status).toBe(404)
  })
})
