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
        const body = (await res.json()) as { total_count: number; incomplete_results: boolean; items: GitHubRepo[] }
        if (page === 1) totalCount = body.total_count
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
      const url = githubId ? `${GITHUB_API}/repositories/${githubId}` : `${GITHUB_API}/repos/${fullName}`
      const res = await request(url, apiHeaders)
      return res ? ((await res.json()) as GitHubRepo) : null
    },

    async listDirectory(fullName, dir, ref) {
      const res = await request(`${GITHUB_API}/repos/${fullName}/contents/${dir}?ref=${encodeURIComponent(ref)}`, apiHeaders)
      if (!res) return null
      const body: unknown = await res.json()
      return Array.isArray(body) ? (body as GitHubContent[]) : null
    },

    async getRawFile(fullName, ref, path) {
      const res = await request(`${GITHUB_RAW}/${fullName}/${ref}/${path}`)
      return res ? res.text() : null
    },
  }
}
