import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { searchQueryString } from '@/sync/github'
import { runDiscoverTemplates } from '@/sync/templates/syncTemplate'
import { AUTO_LIST_QUERY, NOT_PAYLOAD_KEY, runTemplateTopicDiscovery, SUGGEST_QUERIES } from '@/sync/templates/topicDiscovery'
import { jobStatus } from '@/db/jobStatus'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { API, dirEntry, ghRepo, json, pkg, RAW, raw, searchResult } from '../fixtures/sync/github'
import { createPlugin, createRepo, createTemplate } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-22T12:00:00Z')
const searchUrl = (q: string) => `${API}/search/repositories?${searchQueryString(q)}&per_page=100&page=1`
const PAYLOAD_PKG = { dependencies: { payload: '^3.60.0', '@payloadcms/next': '^3.60.0' } }

const repos = {
  starter: ghRepo(501, 'acme/starter', { topics: ['payload-template'], stargazers_count: 12 }),
  astro: ghRepo(502, 'acme/astro-site', { topics: ['payloadcms', 'astro'], stargazers_count: 30, is_template: true }),
  noise: ghRepo(503, 'evil/payload-tool', { topics: ['payload', 'security'], stargazers_count: 400, is_template: true }),
  turbo: ghRepo(504, 'acme/turbo', { topics: ['payloadcms', 'template'], stargazers_count: 5 }),
  archived: ghRepo(505, 'acme/old', { topics: ['payloadcms', 'template'], archived: true }),
  plugin: ghRepo(506, 'acme/seo-plugin', { topics: ['payloadcms', 'template'], stargazers_count: 9 }),
  rejected: ghRepo(507, 'acme/rejected', { topics: ['payloadcms', 'template'], stargazers_count: 9 }),
  stale: ghRepo(508, 'acme/stale', { topics: ['payloadcms', 'starter'], stargazers_count: 0, pushed_at: '2022-01-01T00:00:00Z' }),
  official: ghRepo(509, 'payloadcms/plugin-template', { topics: ['payload', 'template'], stargazers_count: 52 }),
}

function routes(): Record<string, FakeRoute> {
  const r: Record<string, FakeRoute> = {}
  for (const q of [AUTO_LIST_QUERY, ...SUGGEST_QUERIES]) r[searchUrl(q)] = searchResult([])
  r[searchUrl(AUTO_LIST_QUERY)] = searchResult([repos.starter])
  r[searchUrl('topic:payloadcms template:true')] = searchResult([repos.astro])
  r[searchUrl('topic:payload template:true')] = searchResult([repos.noise, repos.official])
  r[searchUrl('topic:payloadcms topic:template')] = searchResult([repos.turbo, repos.archived, repos.plugin, repos.rejected])
  r[searchUrl('topic:payloadcms topic:starter')] = searchResult([repos.stale])
  r[raw('acme/starter', 'package.json')] = pkg(PAYLOAD_PKG)
  r[raw('acme/astro-site', 'package.json')] = pkg({ dependencies: { astro: '^5' } })
  r[raw('acme/astro-site', 'cms/package.json')] = pkg(PAYLOAD_PKG)
  r[raw('acme/turbo', 'package.json')] = pkg({ workspaces: ['apps/*'] })
  r[`${API}/repos/acme/turbo/contents/apps?ref=main`] = json([dirEntry('docs', 'apps/docs'), dirEntry('web', 'apps/web')])
  r[raw('acme/turbo', 'apps/web/package.json')] = pkg(PAYLOAD_PKG)
  r[raw('evil/payload-tool', 'package.json')] = pkg({ dependencies: { express: '^5' } })
  return r
}
const run = (fetch = fakeFetch(routes(), { notFoundPrefixes: [RAW, `${API}/repos/`] })) =>
  runTemplateTopicDiscovery(payload, syncContext(fetch, NOW).github, NOW).then((r) => ({ r, fetch }))
const suggestions = async () =>
  (await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, sort: 'id', where: { origin: { equals: 'discovery' } } })).docs

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const pluginRepo = await createRepo(payload, { fullName: 'acme/seo-plugin', githubId: 506 })
  await createPlugin(payload, pluginRepo.id, { slug: '506-root' })
  const m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 7, login: 'mona' } })
  await payload.create({
    collection: 'submissions', overrideAccess: true,
    data: { type: 'listing', kind: 'template', url: 'https://github.com/acme/rejected', submittedBy: m.id, status: 'rejected' },
  })
})
afterAll(async () => resetDatabase(payload))

describe('runTemplateTopicDiscovery', () => {
  it('lists payload-template repos, suggests Payload projects from broader searches, and skips everything else', async () => {
    const { r } = await run()
    expect(r.autoListed).toEqual([{ fullName: 'acme/starter', githubId: 501, path: null, source: 'topic' }])
    const subs = await suggestions()
    expect(subs.map((s) => s.url)).toEqual(['https://github.com/acme/astro-site', 'https://github.com/acme/turbo']) // most stars first
    expect(subs[0]).toMatchObject({ type: 'listing', kind: 'template', status: 'pending', repositoryFullName: 'acme/astro-site', submittedBy: null })
    expect(subs[0].note).toContain('Found by template discovery (topic:payloadcms template:true)')
    expect(subs[0].note).toContain('GitHub template repository')
    expect(r).toMatchObject({ suggested: 2, notPayload: 1, found: 9 })
  })

  it('remembers repositories that are not Payload projects and never re-suggests or re-checks across runs', async () => {
    await run()
    const { r, fetch } = await run()
    expect(r).toMatchObject({ suggested: 0, notPayload: 0 })
    expect((await suggestions()).length).toBe(2)
    expect(fetch.calls.some((c) => c.url.includes('evil/payload-tool'))).toBe(false)
    const row = (await payload.db.drizzle.select().from(jobStatus)).find((x) => x.key === NOT_PAYLOAD_KEY)
    expect(Object.keys(row?.details ?? {})).toEqual(['evil/payload-tool'])
  })

  it('does not suggest a repository again after the admin rejected the suggestion', async () => {
    await run()
    const [first] = await suggestions()
    await payload.update({ collection: 'submissions', id: first.id, overrideAccess: true, data: { status: 'rejected' } })
    await run()
    expect((await suggestions()).filter((s) => s.url === first.url)).toHaveLength(1)
  })

  it('skips a payload-template repo that is already listed (it is re-synced from the database instead)', async () => {
    const repo = await createRepo(payload, { fullName: 'acme/starter', githubId: 501 })
    await createTemplate(payload, repo.id, { slug: '501-root', source: 'topic' } as never)
    const { r } = await run()
    expect(r.autoListed).toEqual([])
    expect((await runDiscoverTemplates(payload)).filter((i) => i.fullName === 'acme/starter')).toEqual([
      { fullName: 'acme/starter', githubId: 501, path: null, source: 'topic' },
    ])
  })

  it('a suggestion without a submitter can be approved in one step, which queues its sync', async () => {
    await run()
    const [s] = await suggestions()
    await payload.update({ collection: 'submissions', id: s.id, overrideAccess: true, data: { status: 'approved' } })
    const jobs = await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'sync-template' } } })
    expect(jobs.docs.map((j) => (j.input as { fullName: string }).fullName)).toContain('acme/astro-site')
  })

  it('still requires a submitter on submissions people make', async () => {
    await expect(
      payload.create({ collection: 'submissions', overrideAccess: true, data: { type: 'listing', kind: 'template', url: 'https://github.com/a/b' } as never }),
    ).rejects.toMatchObject({ data: { errors: [expect.objectContaining({ path: 'submittedBy', message: expect.stringMatching(/maintainer who made it/) })] } })
  })
})

describe('discover-templates job', () => {
  it('still re-syncs known templates when GitHub discovery fails, and reports the run as partial', async () => {
    const repo = await createRepo(payload, { fullName: 'acme/known', githubId: 600 })
    await createTemplate(payload, repo.id, { slug: '600-root', source: 'submission' } as never)
    await payload.jobs.queue({ task: 'discover-templates', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', limit: 1, overrideAccess: true }) // tests have no network: discovery fails
    const synced = await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'sync-template' } } })
    expect(synced.docs.map((j) => (j.input as { fullName: string }).fullName)).toContain('acme/known')
    const row = (await payload.db.drizzle.select().from(jobStatus)).find((x) => x.key === 'discover-templates')
    expect(row?.details).toMatchObject({ status: 'partial' })
    expect(String(row?.details?.warning)).toMatch(/Template discovery failed/)
  })
})
