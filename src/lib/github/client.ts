import { withTimeout, type FetchFn } from '@/sync/http'
import { canonicalFullName, GITHUB_NAME_RE } from '@/lib/submissions/url'

/**
 * GitHub calls made on behalf of a signed-in maintainer (login, claim verification). Not to be confused with
 * `GitHubClient` in `src/sync/github.ts`, which is the sync pipeline's repository reader.
 */
export type GitHubUser = { id: number; login: string; name: string | null; avatarUrl: string | null }
export type GitHubOwner = { id: number; login: string; type: 'User' | 'Organization' }

/**
 * Failure modes callers can branch on. None of them is thrown: a claim that cannot be verified is queued.
 * `invalid` = the input never reached GitHub; `not-found` = 404; `unavailable` = anything else (403/5xx/network/bad body).
 */
export type LookupFailure = { ok: false; reason: 'invalid' | 'not-found' | 'unavailable' }
export type Lookup<T> = ({ ok: true } & T) | LookupFailure

export interface GitHubAuthClient {
  /** The user a `read:user` OAuth token belongs to. Throws on any failure (the login flow shows an error page). */
  getAuthenticatedUser(accessToken: string): Promise<GitHubUser>
  /** True only when GitHub confirms public membership (204). 404 → false. Anything else throws. */
  isPublicOrgMember(org: string, login: string): Promise<boolean>
  /** Same check as a typed result; never throws. */
  checkPublicOrgMembership(org: string, login: string): Promise<Lookup<{ member: boolean }>>
  /** Live owner of a repository: by numeric id (survives renames and transfers) or by `owner/repo`. */
  getRepositoryOwner(ref: number | string): Promise<Lookup<{ owner: GitHubOwner }>>
  /** A user's current profile (including login) from the immutable numeric id. */
  getUserById(id: number): Promise<Lookup<{ user: GitHubUser }>>
}

const API = 'https://api.github.com'
const TIMEOUT_MS = 10_000
const BASE_HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'payload-directory',
}

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

function safeAvatar(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname.endsWith('.githubusercontent.com') ? url.toString() : null
  } catch {
    return null
  }
}

function toUser(body: unknown): GitHubUser | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (!isId(b.id) || typeof b.login !== 'string' || !GITHUB_NAME_RE.test(b.login)) return null
  return {
    id: b.id,
    login: b.login,
    name: typeof b.name === 'string' ? b.name.slice(0, 200) : null,
    avatarUrl: safeAvatar(b.avatar_url),
  }
}

export function createGitHubAuthClient({
  fetch: baseFetch = globalThis.fetch as FetchFn,
  token = process.env.GITHUB_TOKEN,
}: { fetch?: FetchFn; token?: string } = {}): GitHubAuthClient {
  const doFetch = withTimeout(baseFetch, TIMEOUT_MS)
  // Redirects are never followed: every URL here is a fixed api.github.com path.
  const get = (path: string, authorization?: string) => {
    const headers: Record<string, string> = { ...BASE_HEADERS }
    if (authorization) headers.Authorization = authorization
    return doFetch(`${API}${path}`, { headers, redirect: 'error' })
  }
  const appAuth = token ? `Bearer ${token}` : undefined

  /** Runs a request and maps every failure to a typed result. */
  async function lookup<T>(path: string, map: (res: Response) => Promise<Lookup<T>>): Promise<Lookup<T>> {
    try {
      return await map(await get(path, appAuth))
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }

  async function membership(org: string, login: string): Promise<Lookup<{ member: boolean }>> {
    if (!GITHUB_NAME_RE.test(org) || !GITHUB_NAME_RE.test(login)) return { ok: false, reason: 'invalid' }
    return lookup<{ member: boolean }>(`/orgs/${org}/public_members/${login}`, async (res) => {
      if (res.status === 204) return { ok: true, member: true }
      if (res.status === 404) return { ok: true, member: false }
      return { ok: false, reason: 'unavailable' }
    })
  }

  return {
    async getAuthenticatedUser(accessToken) {
      const res = await get('/user', `Bearer ${accessToken}`)
      if (res.status !== 200) throw new Error(`GitHub /user returned ${res.status}`)
      const user = toUser(await res.json())
      if (!user) throw new Error('GitHub /user returned an unexpected body')
      return user
    },

    async isPublicOrgMember(org, login) {
      if (!GITHUB_NAME_RE.test(org) || !GITHUB_NAME_RE.test(login)) return false
      const res = await get(`/orgs/${org}/public_members/${login}`, appAuth)
      if (res.status === 204) return true
      if (res.status === 404) return false
      throw new Error(`GitHub public_members returned ${res.status}`)
    },

    checkPublicOrgMembership: membership,

    async getRepositoryOwner(ref) {
      let path: string
      if (typeof ref === 'number') {
        if (!isId(ref)) return { ok: false, reason: 'invalid' }
        path = `/repositories/${ref}`
      } else {
        const [owner, repo, ...rest] = ref.split('/')
        const fullName = owner && repo && rest.length === 0 ? canonicalFullName(owner, repo) : null
        if (!fullName) return { ok: false, reason: 'invalid' }
        path = `/repos/${fullName}`
      }
      return lookup<{ owner: GitHubOwner }>(path, async (res) => {
        if (res.status === 404) return { ok: false, reason: 'not-found' }
        if (res.status !== 200) return { ok: false, reason: 'unavailable' }
        const o = ((await res.json()) as { owner?: Record<string, unknown> } | null)?.owner
        if (!o || !isId(o.id) || typeof o.login !== 'string' || !GITHUB_NAME_RE.test(o.login)) return { ok: false, reason: 'unavailable' }
        if (o.type !== 'User' && o.type !== 'Organization') return { ok: false, reason: 'unavailable' }
        return { ok: true, owner: { id: o.id, login: o.login, type: o.type } }
      })
    },

    async getUserById(id) {
      if (!isId(id)) return { ok: false, reason: 'invalid' }
      return lookup<{ user: GitHubUser }>(`/user/${id}`, async (res) => {
        if (res.status === 404) return { ok: false, reason: 'not-found' }
        if (res.status !== 200) return { ok: false, reason: 'unavailable' }
        const user = toUser(await res.json())
        return user ? { ok: true, user } : { ok: false, reason: 'unavailable' }
      })
    },
  }
}
