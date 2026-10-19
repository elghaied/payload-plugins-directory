import { HttpError, RateLimitError, rateLimitResetAt, type FetchFn } from './http'

export interface GitHubRepo {
  id: number
  name: string
  full_name: string
  description: string | null
  stargazers_count: number
  forks_count: number
  pushed_at: string
  created_at: string
  html_url: string
  topics?: string[]
  owner: { login: string; avatar_url: string }
  default_branch: string
  license: { spdx_id: string } | null
  open_issues_count: number
  archived: boolean
}

export interface GitHubContent {
  name: string
  path: string
  type: 'dir' | 'file' | 'symlink' | 'submodule'
}

export type GitHubQuota = { remaining: number; limit: number; resetAt: string }
export type SearchResult = { repos: GitHubRepo[]; complete: boolean; totalCount: number }

export interface GitHubClient {
  /** `topic:payload-plugin fork:true`, every page up to GitHub's 1000-result cap. Archived repos are kept (spec §4.3). */
  searchTopicRepos(): Promise<SearchResult>
  /** By numeric id when known (survives renames), else by full name. null = 404. */
  getRepo(ref: { githubId?: number | null; fullName: string }): Promise<GitHubRepo | null>
  /** Directory listing via the contents API. null = 404, or the path is not a directory. */
  listDirectory(fullName: string, dir: string, ref: string): Promise<GitHubContent[] | null>
  /** File body from raw.githubusercontent.com (no API quota). null = 404; any other failure throws. */
  getRawFile(fullName: string, ref: string, path: string): Promise<string | null>
  /** Last core-API quota seen in response headers (shown by the job-health widget). */
  readonly quota: GitHubQuota | null
}

/** Untrusted repo name, directory, file path or ref (they come from search results and other repos' package.json). */
export class InvalidGitHubPathError extends Error {
  constructor(what: string, value: string) {
    super(`Invalid GitHub ${what}: ${JSON.stringify(value)}`)
    this.name = 'InvalidGitHubPathError'
  }
}

const FULL_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/
const CONTROL = /[\u0000-\u001f\u007f]/

function checkFullName(fullName: string): string {
  if (!FULL_NAME.test(fullName)) throw new InvalidGitHubPathError('repository name', fullName)
  const repo = fullName.split('/')[1]
  if (repo === '.' || repo === '..') throw new InvalidGitHubPathError('repository name', fullName)
  return fullName
}

/** Validates a repo-relative path and encodes it per segment. */
function encodePath(path: string, what: string): string {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('%') || CONTROL.test(path)) {
    throw new InvalidGitHubPathError(what, path)
  }
  const segments = path.split('/')
  if (segments.some((seg) => seg === '' || seg === '.' || seg === '..')) throw new InvalidGitHubPathError(what, path)
  return segments.map(encodeURIComponent).join('/')
}

function encodeRef(ref: string): string {
  if (!ref || ref === '.' || ref === '..' || ref.includes('\\') || CONTROL.test(ref)) throw new InvalidGitHubPathError('ref', ref)
  return encodeURIComponent(ref)
}

/** Final guard: the URL must stay on the expected host and under the expected path prefix. */
function assertUrl(url: string, origin: string, prefix: string): string {
  const u = new URL(url)
  if (u.origin !== origin || !u.pathname.startsWith(prefix)) throw new InvalidGitHubPathError('URL', url)
  return url
}

export const GITHUB_API = 'https://api.github.com'
export const GITHUB_RAW = 'https://raw.githubusercontent.com'
const SEARCH_CAP = 1000
const PER_PAGE = 100
const SEARCH_QUERY = 'q=topic:payload-plugin+fork:true&sort=updated&order=desc'

export function createGitHubClient(opts: { fetch: FetchFn; token?: string; now?: () => Date }): GitHubClient {
  const now = opts.now ?? (() => new Date())
  const apiHeaders: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (opts.token) apiHeaders.Authorization = `Bearer ${opts.token}`
  let quota: GitHubQuota | null = null

  function noteQuota(res: Response): void {
    if (res.headers.get('x-ratelimit-resource') === 'search') return
    const remaining = res.headers.get('x-ratelimit-remaining')
    const limit = res.headers.get('x-ratelimit-limit')
    const reset = res.headers.get('x-ratelimit-reset')
    if (remaining === null || limit === null || reset === null) return
    quota = { remaining: Number(remaining), limit: Number(limit), resetAt: new Date(Number(reset) * 1000).toISOString() }
  }

  /** null on 404; RateLimitError on a rate limit; HttpError on any other non-2xx. */
  async function request(url: string, headers?: Record<string, string>): Promise<Response | null> {
    const res = await opts.fetch(url, headers ? { headers } : undefined)
    if (headers) noteQuota(res)
    const resetAt = rateLimitResetAt(res, now())
    if (resetAt) throw new RateLimitError('github', resetAt)
    if (res.status === 403 && /secondary rate limit/i.test(await res.text().catch(() => ''))) {
      throw new RateLimitError('github', new Date(now().getTime() + 60_000))
    }
    if (res.status === 404) return null
    if (!res.ok) throw new HttpError(res.status, url)
    return res
  }

  return {
    get quota() {
      return quota
    },

    async searchTopicRepos() {
      const byId = new Map<number, GitHubRepo>()
      let totalCount = 0
      let complete = true
      let fetched = 0
      for (let page = 1; fetched < SEARCH_CAP; page++) {
        const url = `${GITHUB_API}/search/repositories?${SEARCH_QUERY}&per_page=${PER_PAGE}&page=${page}`
        const res = await request(url, apiHeaders)
        if (!res) throw new HttpError(404, url)
        const body = (await res.json()) as { total_count?: number; incomplete_results?: boolean; items?: GitHubRepo[] }
        if (!Array.isArray(body.items)) break
        if (page === 1) totalCount = body.total_count ?? 0
        if (body.incomplete_results) complete = false
        // Results are sorted by "updated", so a repo can move between pages mid-pagination: dedupe by id.
        for (const repo of body.items) byId.set(repo.id, repo)
        fetched += body.items.length
        if (body.items.length < PER_PAGE) break
      }
      if (totalCount > SEARCH_CAP) complete = false
      return { repos: [...byId.values()], complete, totalCount }
    },

    async getRepo({ githubId, fullName }) {
      const url = githubId
        ? `${GITHUB_API}/repositories/${Number(githubId)}`
        : assertUrl(`${GITHUB_API}/repos/${checkFullName(fullName)}`, GITHUB_API, '/repos/')
      const res = await request(url, apiHeaders)
      return res ? ((await res.json()) as GitHubRepo) : null
    },

    async listDirectory(fullName, dir, ref) {
      checkFullName(fullName)
      const url = assertUrl(
        `${GITHUB_API}/repos/${fullName}/contents/${encodePath(dir, 'directory')}?ref=${encodeRef(ref)}`,
        GITHUB_API,
        `/repos/${fullName}/contents/`,
      )
      const res = await request(url, apiHeaders)
      if (!res) return null
      const body: unknown = await res.json()
      return Array.isArray(body) ? (body as GitHubContent[]) : null
    },

    async getRawFile(fullName, ref, path) {
      checkFullName(fullName)
      const encRef = encodeRef(ref)
      const url = assertUrl(`${GITHUB_RAW}/${fullName}/${encRef}/${encodePath(path, 'path')}`, GITHUB_RAW, `/${fullName}/${encRef}/`)
      const res = await request(url)
      return res ? res.text() : null
    },
  }
}
