import { describe, expect, it } from 'vitest'
import { createGitHubClient, InvalidGitHubPathError } from '@/sync/github'
import { extractCommunityTemplate, extractOfficialTemplates } from '@/sync/templates/extract'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { API, contents, dirEntry, ghRepo, json, pkg, RAW, raw, text } from '../fixtures/sync/github'

const gh = (routes: Record<string, FakeRoute>) =>
  createGitHubClient({ fetch: fakeFetch(routes, { notFoundPrefixes: [RAW, `${API}/repos/a/b/commits?path=gone`, `${API}/repos/payloadcms/payload/commits`, `${API}/repos/payloadcms/payload/contents/templates`] }), now: () => new Date('2026-10-21T12:00:00Z') })

const commits = (fullName: string, path: string, ref = 'main') =>
  `${API}/repos/${fullName}/commits?path=${path}&sha=${ref}&per_page=1`
const commit = (date: string): FakeRoute => json([{ commit: { committer: { date } } }])

const OFFICIAL = 'payloadcms/payload'
const official = () => ghRepo(1, OFFICIAL, { topics: [], license: { spdx_id: 'MIT' } })
const listing = (names: string[]): FakeRoute =>
  json([...names.map((n) => dirEntry(n, `templates/${n}`)), { name: 'README.md', path: 'templates/README.md', type: 'file' }])

describe('lastCommitDate', () => {
  it('returns the committer date, null for a 404 or an empty list', async () => {
    const client = gh({
      [commits('a/b', 'x', 'main')]: commit('2026-09-01T00:00:00Z'),
      [commits('a/b', 'none')]: json([]),
    })
    expect(await client.lastCommitDate('a/b', 'x', 'main')).toBe('2026-09-01T00:00:00Z')
    expect(await client.lastCommitDate('a/b', 'none', 'main')).toBeNull()
    expect(await client.lastCommitDate('a/b', 'gone', 'main')).toBeNull()
  })

  it('rejects a traversal path', async () => {
    await expect(gh({}).lastCommitDate('a/b', '../x', 'main')).rejects.toBeInstanceOf(InvalidGitHubPathError)
  })
})

describe('extractOfficialTemplates', () => {
  const routes = (): Record<string, FakeRoute> => ({
    [contents(OFFICIAL, 'templates')]: listing(['_data', '_template', 'plugin', 'blank', 'blank-tanstack', 'website', 'categories', 'Bad_Name']),
    [raw(OFFICIAL, 'templates/blank/package.json')]: pkg({ name: 'blank', description: 'Blank', license: 'MIT', dependencies: { payload: 'workspace:*', '@payloadcms/next': 'workspace:*' } }),
    [raw(OFFICIAL, 'templates/blank-tanstack/package.json')]: pkg({ dependencies: { payload: 'workspace:*', '@payloadcms/tanstack-start': 'workspace:*' } }),
    [raw(OFFICIAL, 'templates/website/package.json')]: pkg({ description: 'Website', dependencies: { '@payloadcms/next': 'workspace:*', payload: 'workspace:*' }, devDependencies: { typescript: '5' } }),
    [raw(OFFICIAL, 'templates/website/README.md')]: text('# Website'),
    [commits(OFFICIAL, 'templates/website')]: commit('2026-10-15T08:00:00Z'),
  })

  it('keeps only eligible directories with a package.json', async () => {
    const client = gh(routes())
    const result = await extractOfficialTemplates(official(), client)
    expect(result.map((t) => t.slug)).toEqual(['blank', 'blank-tanstack', 'website'])
    const by = Object.fromEntries(result.map((t) => [t.slug, t]))
    expect(by['blank-tanstack'].stack).toBe('tanstack-start')
    expect(by.website.stack).toBe('nextjs')
    expect(by.website).toMatchObject({
      path: 'templates/website', name: 'Website', isOfficial: true, lastUpdatedAt: '2026-10-15T08:00:00Z',
      payloadVersionRange: 'workspace:*', readme: '# Website', description: 'Website',
      dependencyNames: ['@payloadcms/next', 'payload', 'typescript'],
      url: 'https://github.com/payloadcms/payload/tree/main/templates/website',
    })
    expect(by['blank-tanstack'].name).toBe('Blank Tanstack')
    expect(by.blank.lastUpdatedAt).toBeNull()
    expect(by.blank.license).toBe('MIT')
  })

  it('skips a folder without package.json', async () => {
    const r = routes()
    delete r[raw(OFFICIAL, 'templates/blank/package.json')]
    const result = await extractOfficialTemplates(official(), gh({ ...r}))
    expect(result.map((t) => t.slug)).toEqual(['blank-tanstack', 'website'])
  })

  it('title-cases folder names word by word', async () => {
    const client = gh({
      [contents(OFFICIAL, 'templates')]: listing(['with-vercel-postgres']),
      [raw(OFFICIAL, 'templates/with-vercel-postgres/package.json')]: pkg({ dependencies: {} }),
    })
    expect((await extractOfficialTemplates(official(), client))[0].name).toBe('With Vercel Postgres')
  })

  it('throws when no eligible directory is listed', async () => {
    await expect(extractOfficialTemplates(official(), gh({ [contents(OFFICIAL, 'templates')]: listing(['_data', 'plugin', 'categories']) }))).rejects.toThrow(/refusing/)
    await expect(extractOfficialTemplates(official(), gh({}))).rejects.toThrow(/refusing/) // 404 listing
  })

  it('throws when every eligible directory lacks a package.json', async () => {
    await expect(extractOfficialTemplates(official(), gh({ [contents(OFFICIAL, 'templates')]: listing(['blank']) }))).rejects.toThrow(/refusing/)
  })
})

describe('extractCommunityTemplate', () => {
  it('reads a subfolder and builds the slug from the last segment', async () => {
    const repo = ghRepo(77, 'acme/mono', { pushed_at: '2026-10-02T00:00:00Z', license: { spdx_id: 'Apache-2.0' } })
    const t = await extractCommunityTemplate(repo, gh({
      [raw('acme/mono', 'apps/site/package.json')]: pkg({ name: 'my-site', description: 'Site', license: 'MIT', dependencies: { '@payloadcms/next': '^4', payload: '^4.0.0' } }),
      [raw('acme/mono', 'apps/site/README.md')]: text('# Site'),
    }), 'apps/site')
    expect(t).toEqual({
      slug: '77-site', name: 'my-site', path: 'apps/site', url: 'https://github.com/acme/mono/tree/main/apps/site',
      description: 'Site', readme: '# Site', payloadVersionRange: '^4.0.0', stack: 'nextjs',
      dependencyNames: ['@payloadcms/next', 'payload'], license: 'MIT', lastUpdatedAt: '2026-10-02T00:00:00Z', isOfficial: false,
    })
  })

  it('falls back to the repo for a root without package.json', async () => {
    const t = await extractCommunityTemplate(ghRepo(5, 'acme/cool-starter'), gh({}), null)
    expect(t).toMatchObject({
      slug: '5-root', name: 'cool starter', path: null, url: 'https://github.com/acme/cool-starter', stack: 'other',
      payloadVersionRange: null, dependencyNames: [], license: 'MIT', lastUpdatedAt: '2026-10-01T10:00:00Z', isOfficial: false,
    })
    expect(t.readme).toBeUndefined()
  })

  it('ignores generic package names and bad licenses', async () => {
    for (const name of ['template', 'payload-template']) {
      const t = await extractCommunityTemplate(ghRepo(6, 'acme/fancy-blog', { license: null }), gh({
        [raw('acme/fancy-blog', 'package.json')]: pkg({ name, license: 'x'.repeat(65) }),
      }), null)
      expect(t.name).toBe('fancy blog')
      expect(t.license).toBeNull()
    }
  })

  it('caps dependency names', async () => {
    const deps = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`d${String(i).padStart(3, '0')}`, '1']))
    deps['x'.repeat(215)] = '1'
    const t = await extractCommunityTemplate(ghRepo(8, 'acme/big'), gh({ [raw('acme/big', 'package.json')]: pkg({ dependencies: deps }) }), null)
    expect(t.dependencyNames).toHaveLength(100)
    expect(t.dependencyNames.every((n) => n.length <= 214)).toBe(true)
  })
})
