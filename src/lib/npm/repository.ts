import { withTimeout, type FetchFn } from '@/sync/http'
import { createNpmClient } from '@/sync/npm'
import { normalizeGitHubUrl } from '@/sync/packages'
import { canonicalFullName, NPM_NAME_RE } from '@/lib/submissions/url'

/**
 * `owner/repo` (lower-case) from a package.json `repository` field, if it points at GitHub. Parsing is shared
 * with discover (`normalizeGitHubUrl`); the result is then re-validated with the strict submission rules.
 */
export function githubFullNameFromRepositoryField(field: unknown): string | null {
  const raw =
    typeof field === 'string'
      ? field
      : typeof field === 'object' && field !== null && typeof (field as { url?: unknown }).url === 'string'
        ? (field as { url: string }).url
        : null
  if (!raw || raw.length > 500) return null
  const normalized = normalizeGitHubUrl(raw)
  if (!normalized) return null
  const [owner, repo, ...rest] = normalized.split('/')
  return rest.length === 0 && owner && repo ? canonicalFullName(owner, repo) : null
}

export type NpmRepositoryResult =
  | { status: 'found'; fullName: string }
  | { status: 'not-found' } // unknown package, or an invalid name (never requested)
  | { status: 'no-latest' } // package exists but has no `latest` dist-tag
  | { status: 'not-github' } // no repository field, or it does not point at GitHub

export type NpmRepositoryLookup = (packageName: string) => Promise<NpmRepositoryResult>
export type NpmRepositoryResolver = (packageName: string) => Promise<string | null>

const NPM_TIMEOUT_MS = 10_000

/**
 * Looks a package up on registry.npmjs.org (package metadata only, one request) and says why a repository was or
 * was not found. Built on the sync pipeline's `createNpmClient` so approval and discover parse the repository the
 * same way. Registry failures and rate limits throw; the caller keeps the submission pending.
 */
export function createNpmRepositoryLookup({
  fetch: baseFetch = globalThis.fetch as FetchFn,
}: { fetch?: FetchFn } = {}): NpmRepositoryLookup {
  const timed = withTimeout(baseFetch, NPM_TIMEOUT_MS)
  // Only registry.npmjs.org paths built from a validated name are requested; never follow redirects.
  const client = createNpmClient({
    fetch: (url, init) => timed(url, { ...init, headers: { Accept: 'application/json', ...init?.headers }, redirect: 'error' }),
  })
  return async (packageName) => {
    if (typeof packageName !== 'string' || packageName.length > 214 || !NPM_NAME_RE.test(packageName)) return { status: 'not-found' }
    const info = await client.getRepository(packageName)
    if (!info) return { status: 'not-found' }
    const fullName = githubFullNameFromRepositoryField(info.repositoryUrl)
    if (fullName) return { status: 'found', fullName }
    return { status: info.hasLatest ? 'not-github' : 'no-latest' }
  }
}

/** `owner/repo` (lower-case) or null, for callers that do not need the reason. */
export function createNpmRepositoryResolver(opts: { fetch?: FetchFn } = {}): NpmRepositoryResolver {
  const lookup = createNpmRepositoryLookup(opts)
  return async (packageName) => {
    const result = await lookup(packageName)
    return result.status === 'found' ? result.fullName : null
  }
}
