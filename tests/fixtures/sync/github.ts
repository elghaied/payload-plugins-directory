import type { GitHubContent, GitHubRepo } from '@/sync/github'
import type { FakeRoute } from '../../helpers/fakeFetch'

export const API = 'https://api.github.com'
export const RAW = 'https://raw.githubusercontent.com'
export const REGISTRY = 'https://registry.npmjs.org'
export const DOWNLOADS = 'https://api.npmjs.org/downloads/point'

/** Trimmed copy of a real `GET /repositories/{id}` body: only the fields sync reads. */
export function ghRepo(id: number, fullName: string, over: Partial<GitHubRepo> = {}): GitHubRepo {
  const [owner, name] = fullName.split('/')
  return {
    id,
    name,
    full_name: fullName,
    description: `${name} for Payload`,
    stargazers_count: 42,
    forks_count: 3,
    pushed_at: '2026-10-01T10:00:00Z',
    created_at: '2024-02-01T09:00:00Z',
    html_url: `https://github.com/${fullName}`,
    topics: ['payload-plugin'],
    owner: { login: owner, avatar_url: `https://avatars.githubusercontent.com/u/${id}?v=4` },
    default_branch: 'main',
    license: { spdx_id: 'MIT' },
    open_issues_count: 2,
    archived: false,
    ...over,
  }
}

export const repoById = (id: number) => `${API}/repositories/${id}`
export const repoByName = (fullName: string) => `${API}/repos/${fullName}`
export const contents = (fullName: string, dir: string, ref = 'main') => `${API}/repos/${fullName}/contents/${dir}?ref=${ref}`
export const raw = (fullName: string, path: string, ref = 'main') => `${RAW}/${fullName}/${ref}/${path}`
export const searchPage = (page: number) =>
  `${API}/search/repositories?q=topic:payload-plugin+fork:true&sort=updated&order=desc&per_page=100&page=${page}`
export const dirEntry = (name: string, path: string): GitHubContent => ({ name, path, type: 'dir' })

export const json = (body: unknown, headers?: Record<string, string>): FakeRoute => ({ json: body, headers })
export const text = (body: string): FakeRoute => ({ text: body })
/** A package.json served by raw.githubusercontent.com (pretty-printed like a real file). */
export const pkg = (body: Record<string, unknown>): FakeRoute => ({ text: JSON.stringify(body, null, 2) })
export const searchResult = (items: GitHubRepo[], over: Record<string, unknown> = {}): FakeRoute =>
  json(
    { total_count: items.length, incomplete_results: false, items, ...over },
    { 'x-ratelimit-resource': 'search', 'x-ratelimit-remaining': '29', 'x-ratelimit-limit': '30', 'x-ratelimit-reset': '1792411200' },
  )

/** Registry document + both download endpoints for one package (shapes from the public npm APIs). */
export function npmRoutes(
  name: string,
  o: { version?: string; weekly?: number; monthly?: number; repositoryUrl?: string; deps?: Record<string, string>; published?: string; size?: number } = {},
): Record<string, FakeRoute> {
  const id = encodeURIComponent(name)
  const version = o.version ?? '1.2.0'
  return {
    [`${REGISTRY}/${id}`]: json({
      name,
      'dist-tags': { latest: version },
      time: { [version]: o.published ?? '2026-10-10T00:00:00.000Z' },
      versions: {
        [version]: {
          dependencies: o.deps ?? {},
          dist: { unpackedSize: o.size ?? 20_000 },
          ...(o.repositoryUrl ? { repository: { type: 'git', url: o.repositoryUrl } } : {}),
        },
      },
    }),
    [`${DOWNLOADS}/last-week/${id}`]: json({ downloads: o.weekly ?? 500 }),
    [`${DOWNLOADS}/last-month/${id}`]: json({ downloads: o.monthly ?? 2000 }),
  }
}
