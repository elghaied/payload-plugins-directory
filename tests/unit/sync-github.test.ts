import { describe, expect, it } from 'vitest'
import { createGitHubClient, InvalidGitHubPathError } from '@/sync/github'
import { HttpError, RateLimitError } from '@/sync/http'
import { fakeFetch } from '../helpers/fakeFetch'
import { API, RAW, contents, dirEntry, ghRepo, json, raw, repoById, repoByName, searchPage, searchResult } from '../fixtures/sync/github'

const now = () => new Date('2026-10-19T12:00:00Z')
const coreQuota = { 'x-ratelimit-resource': 'core', 'x-ratelimit-remaining': '4990', 'x-ratelimit-limit': '5000', 'x-ratelimit-reset': '1792411200' }

describe('searchTopicRepos', () => {
  it('paginates until a short page, dedupes by id and keeps archived repos', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ghRepo(i + 1, `acme/p${i + 1}`))
    const page2 = [ghRepo(100, 'acme/p100'), ghRepo(101, 'acme/old', { archived: true }), ghRepo(102, 'acme/p102')]
    const f = fakeFetch({
      [searchPage(1)]: searchResult(page1, { total_count: 102 }),
      [searchPage(2)]: searchResult(page2, { total_count: 102 }),
    })
    const result = await createGitHubClient({ fetch: f, now }).searchTopicRepos()
    expect(result.repos).toHaveLength(102)
    expect(result.repos.find((r) => r.id === 101)?.archived).toBe(true)
    expect(result).toMatchObject({ complete: true, totalCount: 102 })
  })

  it('flags incomplete results and totals above the 1000-result cap', async () => {
    const one = [ghRepo(1, 'acme/a')]
    const a = createGitHubClient({ fetch: fakeFetch({ [searchPage(1)]: searchResult(one, { incomplete_results: true }) }), now })
    expect((await a.searchTopicRepos()).complete).toBe(false)
    const b = createGitHubClient({ fetch: fakeFetch({ [searchPage(1)]: searchResult(one, { total_count: 1500 }) }), now })
    expect((await b.searchTopicRepos()).complete).toBe(false)
  })

  it('does not report the search quota as the core quota', async () => {
    const gh = createGitHubClient({ fetch: fakeFetch({ [searchPage(1)]: searchResult([ghRepo(1, 'acme/a')]) }), now })
    await gh.searchTopicRepos()
    expect(gh.quota).toBeNull()
  })
})

describe('getRepo', () => {
  it('fetches by GitHub id with the token and records the core quota', async () => {
    const f = fakeFetch({ [repoById(7)]: json(ghRepo(7, 'acme/seo'), coreQuota) })
    const gh = createGitHubClient({ fetch: f, token: 't0k', now })
    expect((await gh.getRepo({ githubId: 7, fullName: 'acme/seo' }))?.full_name).toBe('acme/seo')
    expect(new Headers(f.calls[0].init?.headers).get('authorization')).toBe('Bearer t0k')
    expect(gh.quota).toEqual({ remaining: 4990, limit: 5000, resetAt: new Date(1792411200 * 1000).toISOString() })
  })

  it('falls back to the full name and returns null on 404', async () => {
    const gh = createGitHubClient({ fetch: fakeFetch({ [repoByName('acme/gone')]: { status: 404 } }), now })
    expect(await gh.getRepo({ fullName: 'acme/gone' })).toBeNull()
  })

  it('throws RateLimitError when the quota is exhausted', async () => {
    const f = fakeFetch({ [repoById(7)]: { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792411200' } } })
    await expect(createGitHubClient({ fetch: f, now }).getRepo({ githubId: 7, fullName: 'acme/seo' })).rejects.toBeInstanceOf(RateLimitError)
  })

  it('throws HttpError on server errors', async () => {
    const f = fakeFetch({ [repoById(7)]: { status: 502 } })
    await expect(createGitHubClient({ fetch: f, now }).getRepo({ githubId: 7, fullName: 'acme/seo' })).rejects.toBeInstanceOf(HttpError)
  })
})

describe('listDirectory', () => {
  it('returns entries, and null for a 404 or a file path', async () => {
    const f = fakeFetch({
      [contents('acme/mono', 'packages')]: json([dirEntry('a', 'packages/a')]),
      [contents('acme/mono', 'nope')]: { status: 404 },
      [contents('acme/mono', 'README.md')]: json({ name: 'README.md', path: 'README.md', type: 'file' }),
    })
    const gh = createGitHubClient({ fetch: f, now })
    expect(await gh.listDirectory('acme/mono', 'packages', 'main')).toEqual([dirEntry('a', 'packages/a')])
    expect(await gh.listDirectory('acme/mono', 'nope', 'main')).toBeNull()
    expect(await gh.listDirectory('acme/mono', 'README.md', 'main')).toBeNull()
  })
})

describe('getRawFile', () => {
  it('returns text without API headers, null on 404, and throws on 5xx', async () => {
    const f = fakeFetch({
      [raw('acme/seo', 'package.json')]: { text: '{"name":"x"}' },
      [raw('acme/seo', 'README.md')]: { status: 404 },
      [raw('acme/seo', 'LICENSE')]: { status: 500 },
    })
    const gh = createGitHubClient({ fetch: f, token: 't0k', now })
    expect(await gh.getRawFile('acme/seo', 'main', 'package.json')).toBe('{"name":"x"}')
    expect(f.calls[0].init).toBeUndefined()
    expect(await gh.getRawFile('acme/seo', 'main', 'README.md')).toBeNull()
    await expect(gh.getRawFile('acme/seo', 'main', 'LICENSE')).rejects.toBeInstanceOf(HttpError)
  })
})

describe('path validation', () => {
  it('rejects traversal in dir and path without fetching', async () => {
    const f = fakeFetch({})
    const gh = createGitHubClient({ fetch: f, token: 't', now })
    for (const dir of ['../../user', '/abs', 'a//b', 'a/./b', 'a\\b', '%2e%2e/x', 'a/\u0000', '']) {
      await expect(gh.listDirectory('acme/x', dir, 'main')).rejects.toBeInstanceOf(InvalidGitHubPathError)
    }
    await expect(gh.getRawFile('acme/x', 'main', '../../../etc')).rejects.toBeInstanceOf(InvalidGitHubPathError)
    expect(f.calls).toHaveLength(0)
  })

  it('rejects malformed full names', async () => {
    const f = fakeFetch({})
    const gh = createGitHubClient({ fetch: f, now })
    for (const name of ['acme/../x', 'acme', 'a/b/c', 'acme/..', '-a/b']) {
      await expect(gh.getRepo({ fullName: name })).rejects.toBeInstanceOf(InvalidGitHubPathError)
      await expect(gh.listDirectory(name, 'packages', 'main')).rejects.toBeInstanceOf(InvalidGitHubPathError)
      await expect(gh.getRawFile(name, 'main', 'package.json')).rejects.toBeInstanceOf(InvalidGitHubPathError)
    }
    expect(f.calls).toHaveLength(0)
  })

  it('builds expected URLs for normal input and encodes refs', async () => {
    const f = fakeFetch({
      [contents('acme/x', 'packages/plugin-seo')]: json([]),
      [raw('acme/x', 'package.json')]: { text: '{}' },
      [`${API}/repos/acme/x/contents/packages?ref=release%2Fv2`]: json([]),
      [`${RAW}/acme/x/release%2Fv2/package.json`]: { text: '{}' },
    })
    const gh = createGitHubClient({ fetch: f, now })
    await gh.listDirectory('acme/x', 'packages/plugin-seo', 'main')
    await gh.getRawFile('acme/x', 'main', 'package.json')
    await gh.listDirectory('acme/x', 'packages', 'release/v2')
    await gh.getRawFile('acme/x', 'release/v2', 'package.json')
    expect(f.calls).toHaveLength(4)
  })
})

describe('hardening', () => {
  it('treats a missing items array as the end of results', async () => {
    const f = fakeFetch({ [searchPage(1)]: json({ total_count: 0 }) })
    const result = await createGitHubClient({ fetch: f, now }).searchTopicRepos()
    expect(result.repos).toEqual([])
  })

  it('maps a secondary rate limit 403 to RateLimitError at now+60s', async () => {
    const f = fakeFetch({ [repoById(7)]: { status: 403, text: 'You have exceeded a Secondary Rate Limit.' } })
    const err = await createGitHubClient({ fetch: f, now }).getRepo({ githubId: 7, fullName: 'acme/seo' }).catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.resetAt.toISOString()).toBe('2026-10-19T12:01:00.000Z')
  })

  it('keeps a plain 403 an HttpError', async () => {
    const f = fakeFetch({ [repoById(7)]: { status: 403, text: 'Forbidden' } })
    await expect(createGitHubClient({ fetch: f, now }).getRepo({ githubId: 7, fullName: 'acme/seo' })).rejects.toBeInstanceOf(HttpError)
  })
})
