import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { handleEndpoints, type Payload } from 'payload'
import type { ReadmeRendering } from '@/sync/context'
import { readmeStamp } from '@/lib/directory/readmeStamp'
import { renderReadmeBatch, renderReadmes } from '@/lib/directory/renderReadmes'
import { runSyncRepository } from '@/sync/syncRepository'
import { ghRepo, json, pkg, raw, repoById, text } from '../fixtures/sync/github'
import { createPlugin, createRepo, searchDocsFor } from './helpers/directory'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { getCleanReadmeHtml } from '@/lib/directory/readmeClean'
import { callTool } from './helpers/mcp'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext, syncFetch } from './helpers/syncContext'

// The summary list is served from cache like production; other cached queries run live.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[]) => {
    if (keyParts[0] !== 'plugin-summaries') return fn
    let memo: Promise<unknown> | undefined
    return (...a: unknown[]) => (memo ??= fn(...a))
  },
}))

const MARKER = 'READMEHTML-MARKER-9f3a'
let payload: Payload

const rendering = (version = 'v1', onRender?: (source: string) => Promise<void>): ReadmeRendering & { calls: { source: string; repo: unknown }[] } => {
  const calls: { source: string; repo: unknown }[] = []
  return {
    calls,
    version: () => version,
    render: async (source, repo) => {
      calls.push({ source, repo })
      await onRender?.(source)
      return source.includes('HOSTILE') ? { html: null, reason: 'cap:nesting' } : { html: `<p>${source.length}</p>` }
    },
  }
}

beforeAll(async () => {
  payload = await getTestPayload()
})
beforeEach(async () => {
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('readmeHtml is never part of the public surface', () => {
  it('is absent from the anonymous Local API, REST, MCP and the search index; present for the detail page', async () => {
    const repo = await createRepo(payload)
    const doc = await createPlugin(payload, repo.id, { slug: 'html-plugin', name: 'Html Plugin', readme: '# plain readme', readmeHtml: `<p>${MARKER}</p>`, readmeRenderVersion: 'old-stamp' } as never)

    const anon = await payload.find({ collection: 'plugins', overrideAccess: false, user: null, where: { slug: { equals: 'html-plugin' } } })
    expect(anon.docs[0]).not.toHaveProperty('readmeHtml')
    expect(anon.docs[0]).not.toHaveProperty('readmeRenderVersion')
    const raw = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: 'html-plugin' } } })
    expect(raw.docs[0].readmeHtml).toContain(MARKER)

    for (const path of ['/api/plugins', `/api/plugins/${doc.id}`, '/api/plugins?depth=2&select[readmeHtml]=true']) {
      const res = await handleEndpoints({ config: payload.config, request: new Request(`http://localhost${path}`) })
      expect(await res.text()).not.toContain(MARKER)
    }
    expect(JSON.stringify(await callTool(payload, 'getPlugin', { slug: 'html-plugin' }))).not.toContain(MARKER)
    expect(JSON.stringify(await callTool(payload, 'searchPlugins', { query: 'html' }))).not.toContain(MARKER)
    expect(JSON.stringify(await searchDocsFor(payload, 'plugins', doc.id))).not.toContain(MARKER)

    const { getPluginDetail } = await import('@/lib/directory/queries')
    // a stamp made from different text (an edited README) is stale: no HTML
    expect((await getPluginDetail('html-plugin'))?.readmeHtml).toBeUndefined()
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, context: { skipRevalidate: true }, data: { readmeRenderVersion: readmeStamp('v1', '# plain readme') } })
    vi.resetModules()
    const fresh = await import('@/lib/directory/queries')
    expect((await fresh.getPluginDetail('html-plugin'))?.readmeHtml).toContain(MARKER)
  })
})

describe('sync-time rendering', () => {
  const SEO = ghRepo(7, 'acme/payload-seo', { pushed_at: '2026-10-18T09:00:00Z', topics: ['payload-plugin'] })
  const routes = (readme: string) => ({
    [repoById(SEO.id)]: json(SEO),
    [raw(SEO.full_name, 'package.json')]: pkg({ name: 'payload-seo', description: 'SEO', peerDependencies: { payload: '^3.0.0' } }),
    [raw(SEO.full_name, 'README.md')]: text(readme),
  })
  const input = { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' as const }
  const NOW = new Date('2026-10-19T12:00:00Z')
  const sync = (readme: string, r?: ReadmeRendering, now = NOW) =>
    runSyncRepository(payload, input, { ...syncContext(syncFetch(routes(readme)), now), ...(r ? { readme: r } : {}) })
  const row = async () => (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: '7-root' } } })).docs[0]

  it('renders a new README in the renderer with the repository reference and stores HTML plus the version', async () => {
    const r = rendering('v1')
    await sync('# Hello', r)
    expect(r.calls).toEqual([{ source: '# Hello', repo: { fullName: 'acme/payload-seo', defaultBranch: 'main', path: null } }])
    expect(await row()).toMatchObject({ readmeHtml: '<p>7</p>', readmeRenderVersion: readmeStamp('v1', '# Hello') })
  })

  it('does not render again while the README text and the version are unchanged', async () => {
    const r = rendering('v1')
    await sync('# Hello', r)
    await sync('# Hello', r, new Date('2026-10-20T12:00:00Z'))
    expect(r.calls).toHaveLength(1)
  })

  it('re-renders when the README changes', async () => {
    const r = rendering('v1')
    await sync('# Hello', r)
    const later = new Date('2026-10-20T12:00:00Z')
    SEO.pushed_at = '2026-10-20T09:00:00Z'
    await sync('# Hello again, longer', r, later)
    expect(r.calls).toHaveLength(2)
    expect((await row()).readmeHtml).toBe('<p>21</p>')
  })

  it('re-renders when the render version differs', async () => {
    await sync('# Hello', rendering('v1'))
    const r2 = rendering('v2')
    SEO.pushed_at = '2026-10-21T09:00:00Z'
    await sync('# Hello', r2, new Date('2026-10-21T12:00:00Z'))
    expect(r2.calls).toHaveLength(1)
    expect(await row()).toMatchObject({ readmeRenderVersion: readmeStamp('v2', '# Hello') })
  })

  it('stores null HTML (plain text) with the version when the renderer refuses, so it is not retried every sync', async () => {
    const r = rendering('v1')
    await sync('HOSTILE', r)
    expect(await row()).toMatchObject({ readmeHtml: null, readmeRenderVersion: readmeStamp('v1', 'HOSTILE') })
    SEO.pushed_at = '2026-10-22T09:00:00Z'
    await sync('HOSTILE', r, new Date('2026-10-22T12:00:00Z'))
    expect(r.calls).toHaveLength(1)
  })

  it('never renders in-process: without a renderer the HTML fields are left untouched', async () => {
    await sync('# Hello')
    expect((await row()).readmeHtml ?? null).toBeNull()
  })
})

describe('payload render-readmes backfill', () => {
  it('re-renders only rows with an out-of-date version (all: every row), with the monorepo path and repository facts', async () => {
    const repo = await createRepo(payload, { fullName: 'acme/mono', defaultBranch: 'trunk' })
    await createPlugin(payload, repo.id, { slug: 'old', readme: '# old', path: 'packages/old' } as never)
    await createPlugin(payload, repo.id, { slug: 'current', readme: '# current', readmeRenderVersion: readmeStamp('v2', '# current'), readmeHtml: '<p>keep</p>' } as never)
    await createPlugin(payload, repo.id, { slug: 'hostile', readme: 'HOSTILE' } as never)
    await createPlugin(payload, repo.id, { slug: 'no-readme' } as never) // no README: never rendered

    const r = rendering('v2')
    const result = await renderReadmes(payload, r)
    expect(result).toMatchObject({ considered: 3, rendered: 2, skipped: 1, withHtml: 1, plainText: 1, raced: 0, reasons: { 'cap:nesting': 1 } })
    expect(r.calls.find((c) => c.source === '# old')?.repo).toEqual({ fullName: 'acme/mono', defaultBranch: 'trunk', path: 'packages/old' })
    const bySlug = async (slug: string) => (await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: slug } } })).docs[0]
    expect(await bySlug('old')).toMatchObject({ readmeHtml: '<p>5</p>', readmeRenderVersion: readmeStamp('v2', '# old') })
    expect(await bySlug('current')).toMatchObject({ readmeHtml: '<p>keep</p>' })
    expect(await bySlug('hostile')).toMatchObject({ readmeHtml: null, readmeRenderVersion: readmeStamp('v2', 'HOSTILE') })

    const again = rendering('v2')
    expect(await renderReadmes(payload, again)).toMatchObject({ rendered: 0, skipped: 3 })
    expect(again.calls).toHaveLength(0)
    expect(await renderReadmes(payload, rendering('v2'), { all: true })).toMatchObject({ rendered: 3 })
    expect(await renderReadmes(payload, rendering('v3'))).toMatchObject({ rendered: 3 })
  })
})

describe('readmeHtml is written by system code only', () => {
  it('an admin REST PATCH and a maintainer REST PATCH cannot change readmeHtml or readmeRenderVersion', async () => {
    const repo = await createRepo(payload)
    const maintainer = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 901, login: 'html-owner' } })
    const doc = await createPlugin(payload, repo.id, {
      slug: 'owned', name: 'Owned', readme: '# r', readmeHtml: '<p>ORIGINAL</p>', readmeRenderVersion: 'v1', maintainers: [maintainer.id],
    } as never)
    const email = 'html-admin@example.com'
    await payload.create({ collection: 'users', overrideAccess: true, data: { email, password: 'correct-horse-battery-staple' } })
    const { token } = await payload.login({ collection: 'users', data: { email, password: 'correct-horse-battery-staple' }, overrideAccess: true })
    const session = await signSessionToken({ maintainerId: maintainer.id, githubId: 901 }, getSessionSecret())

    const patch = (headers: Record<string, string>, body: object) =>
      handleEndpoints({
        config: payload.config,
        request: new Request(`http://localhost/api/plugins/${doc.id}`, {
          method: 'PATCH', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
        }),
      })
    const stored = async () => (await payload.findByID({ collection: 'plugins', id: doc.id, overrideAccess: true, depth: 0 }))

    const adminRes = await patch({ Authorization: `JWT ${token}` }, { name: 'Renamed by admin', readmeHtml: '<p>EVIL-ADMIN</p>', readmeRenderVersion: 'evil' })
    expect(adminRes.status).toBe(200) // the request was authorised and processed...
    expect((await stored()).name).toBe('Renamed by admin')
    expect(await stored()).toMatchObject({ readmeHtml: '<p>ORIGINAL</p>', readmeRenderVersion: 'v1' }) // ...but the fields were ignored

    const maintRes = await patch({ cookie: `${SESSION_COOKIE}=${session}` }, { customTagline: 'Set by maintainer', readmeHtml: '<p>EVIL-MAINT</p>', readmeRenderVersion: 'evil' })
    expect([200, 400, 403]).toContain(maintRes.status)
    expect(await stored()).toMatchObject({ readmeHtml: '<p>ORIGINAL</p>', readmeRenderVersion: 'v1' })

    // Local API with access control on, as an admin user
    const adminUser = (await payload.find({ collection: 'users', overrideAccess: true, where: { email: { equals: email } } })).docs[0]
    await payload.update({ collection: 'plugins', id: doc.id, user: { ...adminUser, collection: 'users' } as never, overrideAccess: false, data: { readmeHtml: '<p>EVIL-LOCAL</p>' } as never })
    expect((await stored()).readmeHtml).toBe('<p>ORIGINAL</p>')
  })
})

describe('re-sanitization on read', () => {
  it('a hand-written malicious stored value comes out clean through the detail path', async () => {
    const repo = await createRepo(payload)
    const evil = '<p>fine</p><img src=x onerror=alert(1)><script>alert(2)</script><a href="javascript:alert(3)">j</a><iframe src="https://e.example"></iframe><style>*{display:none}</style>'
    await createPlugin(payload, repo.id, { slug: 'evil-html', name: 'Evil', readme: '# r', readmeHtml: evil, readmeRenderVersion: readmeStamp('v1', '# r') } as never)
    vi.resetModules() // a fresh summary-list memo that includes this plugin
    const { getPluginDetail } = await import('@/lib/directory/queries')
    const detail = await getPluginDetail('evil-html')
    expect(detail?.readmeHtml).toBe(evil) // stored as written (system-only field)...
    const clean = await getCleanReadmeHtml('evil-html', detail!.readmeHtml!, detail!.readmeRenderVersion ?? null)
    expect(clean).toContain('<p>fine</p>') // ...and cleaned before it reaches the page
    expect(clean).not.toMatch(/<script|<iframe|<style|onerror|javascript:|alert\(/i)
  })
})

describe('sync only renders in the worker (M7)', () => {
  it('createSyncContext attaches the renderer only when DIRECTORY_ROLE=worker', async () => {
    const { createSyncContext, getSyncDeps } = await import('@/sync/deps')
    const web = vi.stubEnv('DIRECTORY_ROLE', '')
    expect(createSyncContext(getSyncDeps()).readme).toBeUndefined()
    vi.stubEnv('DIRECTORY_ROLE', 'worker')
    expect(createSyncContext(getSyncDeps()).readme).toBeDefined()
    web.unstubAllEnvs()
  })

  it('a sync run on web (admin /api/payload-jobs/run) succeeds and leaves readmeHtml untouched', async () => {
    vi.stubEnv('DIRECTORY_ROLE', '')
    const { createSyncContext, getSyncDeps } = await import('@/sync/deps')
    const SEO = ghRepo(11, 'acme/web-sync', { pushed_at: '2026-10-18T09:00:00Z', topics: ['payload-plugin'] })
    const f = syncFetch({
      [repoById(SEO.id)]: json(SEO),
      [raw(SEO.full_name, 'package.json')]: pkg({ name: 'web-sync', description: 'x', peerDependencies: { payload: '^3.0.0' } }),
      [raw(SEO.full_name, 'README.md')]: text('# Web'),
    })
    // The context a task handler would build on web: same wiring, only the fetch is injected.
    const ctx = { ...syncContext(f, new Date('2026-10-19T12:00:00Z')), readme: createSyncContext(getSyncDeps()).readme }
    expect(ctx.readme).toBeUndefined()
    const r = await runSyncRepository(payload, { fullName: 'acme/web-sync', githubId: 11, source: 'topic' }, ctx)
    expect(r.created).toEqual(['11-root'])
    const doc = (await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '11-root' } } })).docs[0]
    expect(doc.readme).toBe('# Web')
    expect(doc.readmeHtml ?? null).toBeNull()
    expect(doc.readmeRenderVersion ?? null).toBeNull()
    vi.unstubAllEnvs()
  })
})

describe('write guard (M5)', () => {
  it('does not store a render whose README changed while it was rendering', async () => {
    const repo = await createRepo(payload)
    const doc = await createPlugin(payload, repo.id, { slug: 'racy', readme: '# first' } as never)
    const r = rendering('v1', async () => {
      // a sync (or an admin) rewrites the README while the worker is busy
      await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, context: { skipRevalidate: true }, data: { readme: '# second, newer' } })
    })
    const result = await renderReadmes(payload, r)
    expect(result).toMatchObject({ rendered: 0, raced: 1 })
    const stored = await payload.findByID({ collection: 'plugins', id: doc.id, overrideAccess: true })
    expect(stored.readme).toBe('# second, newer')
    expect(stored.readmeHtml ?? null).toBeNull()
    // the next run renders the new text
    expect(await renderReadmes(payload, rendering('v1'))).toMatchObject({ rendered: 1, raced: 0 })
    expect((await payload.findByID({ collection: 'plugins', id: doc.id, overrideAccess: true })).readmeRenderVersion).toBe(readmeStamp('v1', '# second, newer'))
  })
})

describe('render-readmes job (I1, M11)', () => {
  const jobs = async () => (await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'render-readmes' } }, limit: 0, pagination: false })).docs

  it('processes in batches and queues its own continuation; idle when everything is current', async () => {
    const repo = await createRepo(payload)
    for (let i = 0; i < 5; i++) await createPlugin(payload, repo.id, { slug: `batch-${i}`, readme: `# readme ${i}` } as never)
    const r = rendering('v1')
    const first = await renderReadmeBatch(payload, r, { limit: 2 })
    expect(first).toMatchObject({ rendered: 2, more: true })
    const second = await renderReadmeBatch(payload, r, { limit: 2, afterId: first.lastId })
    expect(second).toMatchObject({ rendered: 2, more: true })
    const third = await renderReadmeBatch(payload, r, { limit: 2, afterId: second.lastId })
    expect(third).toMatchObject({ rendered: 1, more: false })
    expect(r.calls).toHaveLength(5)
    expect(await renderReadmeBatch(payload, rendering('v1'))).toMatchObject({ rendered: 0, skipped: 5, more: false })
  })

  it('the task has a single concurrency key, a daily schedule and retries', async () => {
    const { renderReadmesTask } = await import('@/sync/readmeTask')
    expect((renderReadmesTask.concurrency as () => string)()).toBe('render-readmes')
    expect(renderReadmesTask.schedule).toEqual([{ cron: '15 2 * * *', queue: 'default' }])
    expect(renderReadmesTask.retries).toMatchObject({ attempts: 5 })
    expect((payload.config.jobs.tasks ?? []).map((t) => t.slug)).toContain('render-readmes')
  })

  it('running the job outside the worker is a skipped no-op, not a failure', async () => {
    vi.stubEnv('DIRECTORY_ROLE', '')
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'idle', readme: '# idle' } as never)
    await payload.jobs.queue({ task: 'render-readmes', input: {}, queue: 'default', overrideAccess: true })
    const res = await payload.jobs.run({ queue: 'default', limit: 5, overrideAccess: true })
    expect(Object.values(res.jobStatus ?? {}).every((j) => !(j as { hasError?: boolean }).hasError)).toBe(true)
    expect((await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: 'idle' } } })).docs[0].readmeHtml ?? null).toBeNull()
    vi.unstubAllEnvs()
  })

  it('an admin edit of the README queues a re-render job; a sync-style write does not', async () => {
    const repo = await createRepo(payload)
    const doc = await createPlugin(payload, repo.id, { slug: 'edited', readme: '# one' } as never)
    const before = (await jobs()).length
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, context: { skipRevalidate: true }, data: { readme: '# two' } })
    expect((await jobs()).length).toBe(before)
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { readme: '# three' } })
    expect((await jobs()).length).toBe(before + 1)
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { name: 'Renamed' } })
    expect((await jobs()).length).toBe(before + 1)
  })
})
