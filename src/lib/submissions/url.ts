/** A GitHub user or organisation login (GitHub's own limit is 39 characters). */
export const GITHUB_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/
/** Canonical (lower-case) `owner/repo`, as stored in `submissions.repositoryFullName`. */
export const FULL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9._-]{1,100}$/
/** npm package names (new-style: lower-case, optional scope). */
export const NPM_NAME_RE = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const GITHUB_HOSTS = new Set(['github.com', 'www.github.com'])
const NPM_HOSTS = new Set(['npmjs.com', 'www.npmjs.com'])
// First path segments on github.com that are not users or organisations.
const GITHUB_RESERVED = new Set([
  'about', 'apps', 'collections', 'enterprise', 'explore', 'features', 'login', 'marketplace', 'new',
  'notifications', 'orgs', 'organizations', 'pricing', 'repos', 'search', 'settings', 'sponsors', 'topics', 'trending', 'users',
])

export type SubmissionTarget =
  | { kind: 'github'; fullName: string; canonicalUrl: string }
  | { kind: 'npm'; packageName: string; canonicalUrl: string }

export function canonicalFullName(owner: string, repo: string): string | null {
  const name = repo.replace(/\.git$/i, '')
  if (!GITHUB_NAME_RE.test(owner) || !REPO_NAME_RE.test(name) || name === '.' || name === '..') return null
  if (GITHUB_RESERVED.has(owner.toLowerCase())) return null
  return `${owner}/${name}`.toLowerCase()
}

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment)
  } catch {
    return null
  }
}

export const TEMPLATE_PATH_MAX = 300
const TEMPLATE_PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/

/** A repository-relative template folder (`apps/site`): segments `[A-Za-z0-9._-]+`, no dot segments, at most 300 characters. */
export function validTemplatePath(path: string): boolean {
  if (!path || path.length > TEMPLATE_PATH_MAX) return false
  return path.split('/').every((s) => TEMPLATE_PATH_SEGMENT_RE.test(s) && s !== '.' && s !== '..')
}

export type TemplateSubmissionTarget = { fullName: string; canonicalUrl: string; path: string | null }

/**
 * Strictly parses a template URL: `https://github.com/o/r` (the repository root) or
 * `https://github.com/o/r/tree/<ref>/<path…>` (a folder; the ref is dropped). npm and every other GitHub page are
 * rejected. The canonical URL names the folder at `HEAD` and parses back to the same target.
 */
export function parseTemplateSubmissionUrl(input: string): TemplateSubmissionTarget | null {
  const base = parseSubmissionUrl(input)
  if (base?.kind !== 'github') return null
  // parseSubmissionUrl already refused non-ASCII, credentials, ports and dot segments; re-read the path to keep its tail.
  const raw = input.trim()
  const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`)
  const rest = url.pathname.split('/').filter(Boolean).slice(2)
  if (rest.length === 0) return { fullName: base.fullName, canonicalUrl: base.canonicalUrl, path: null }
  if (rest[0] !== 'tree' || rest.length < 2) return null
  if (rest.length === 2) return { fullName: base.fullName, canonicalUrl: base.canonicalUrl, path: null }
  // Raw segments: an encoded `/`, space or dot never decodes into something the pattern would accept.
  const path = rest.slice(2).join('/')
  if (!validTemplatePath(path)) return null
  return { fullName: base.fullName, canonicalUrl: `${base.canonicalUrl}/tree/HEAD/${path}`, path }
}

/**
 * Strictly parses a plugin URL typed by a maintainer. Only https GitHub repository URLs and npm package
 * pages are accepted; everything is reduced to an identifier. The URL itself is never fetched.
 */
export function parseSubmissionUrl(input: string): SubmissionTarget | null {
  const raw = input.trim()
  if (!raw || raw.length > 300 || /[\s\u0000-\u001f\u007f\\]/.test(raw)) return null
  // ASCII only: full-width, soft-hyphen, zero-width or bidi characters are rejected, never normalised into a host.
  if (/[^\u0021-\u007e]/.test(raw)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean).map(decodeSegment)
  if (segments.some((s) => s === null)) return null
  const parts = segments as string[]
  // Dot segments (raw or %2e) are rejected, not resolved: `/acme/repo/../../evil/x` must not become `evil/x`.
  if (/(?:^|\/)(?:\.{1,2}|%2e|\.%2e|%2e\.|%2e%2e)(?:\/|$)/i.test(raw.split(/[?#]/)[0]) || parts.some((p) => p === '.' || p === '..')) return null

  if (GITHUB_HOSTS.has(host)) {
    if (parts.length < 2) return null
    const fullName = canonicalFullName(parts[0], parts[1])
    return fullName ? { kind: 'github', fullName, canonicalUrl: `https://github.com/${fullName}` } : null
  }

  if (NPM_HOSTS.has(host)) {
    if (parts[0] !== 'package' || !parts[1]) return null
    const first = parts[1]
    const packageName = first.startsWith('@') && !first.includes('/') ? `${first}/${parts[2] ?? ''}` : first
    if (packageName.length > 214 || !NPM_NAME_RE.test(packageName)) return null
    return { kind: 'npm', packageName, canonicalUrl: `https://www.npmjs.com/package/${packageName}` }
  }

  return null
}
