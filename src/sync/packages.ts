import type { PackageJson } from '@/types'

/** Directory / package names that are never plugins (ported unchanged from scripts/fetch-plugins.ts). */
export const INVALID_PACKAGE_NAMES = new Set([
  'dev', 'test', 'tests', 'example', 'examples', 'demo', 'sample',
  'app', 'web', 'client', 'server', 'api', 'core', 'lib', 'utils',
  'config', 'docs', 'packages', 'src', 'dist', 'build', 'scripts',
  'undefined', 'null', 'true', 'false',
  'testbed', 'playground', 'e2e', 'fixtures',
])

const NPM_NAME = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

export function isValidPackageName(name: string | null | undefined): name is string {
  if (!name) return false
  if (INVALID_PACKAGE_NAMES.has(name.toLowerCase())) return false
  return NPM_NAME.test(name)
}

export function getPayloadVersion(pkg: PackageJson): string | null {
  return pkg.peerDependencies?.payload || pkg.dependencies?.payload || pkg.devDependencies?.payload || null
}

function workspacePatterns(pkg: PackageJson): string[] {
  const ws: unknown = pkg.workspaces
  const list: unknown = Array.isArray(ws) ? ws : ws && typeof ws === 'object' ? (ws as { packages?: unknown }).packages : undefined
  return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string') : []
}

export function isMonorepo(pkg: PackageJson): boolean {
  return workspacePatterns(pkg).length > 0
}

/** Unique top-level directories of workspace globs: ["packages/*", "plugins/*"] -> ["packages", "plugins"]. */
export function getWorkspaceDirs(pkg: PackageJson): string[] {
  const dirs = new Set<string>()
  for (const pattern of workspacePatterns(pkg)) {
    const top = pattern.split('/')[0]
    if (top && top !== '*' && top !== '**') dirs.add(top)
  }
  return [...dirs]
}

/** A monorepo sub-package counts as a plugin when it is public and needs payload at runtime. */
export function isLikelyPlugin(dirName: string, pkg: PackageJson): boolean {
  if (INVALID_PACKAGE_NAMES.has(dirName.toLowerCase())) return false
  if (pkg.private) return false
  return Boolean(pkg.peerDependencies?.payload || pkg.dependencies?.payload)
}

/** "owner/repo" (lower case) from the URL forms npm stores; null when it is not a GitHub URL. */
export function normalizeGitHubUrl(url: string | null | undefined): string | null {
  if (!url) return null
  const cleaned = url.replace(/^git\+/, '').replace(/\.git$/, '').trim()
  const full = cleaned.match(/github\.com[/:]([\w.-]+\/[\w.-]+)/i)
  if (full) return full[1].toLowerCase()
  const short = cleaned.match(/^github:([\w.-]+\/[\w.-]+)/i)
  return short ? short[1].toLowerCase() : null
}

/** "owner/repo" from a github.com URL, case kept (GitHub resolves case-insensitively); null otherwise. */
export function parseGitHubFullName(url: string): string | null {
  const m = url.trim().match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i)
  return m ? `${m[1]}/${m[2]}` : null
}

/** Package name from an npmjs.com package URL; null otherwise. */
export function parseNpmPackageName(url: string): string | null {
  const m = url.trim().match(/^https?:\/\/(?:www\.)?npmjs\.com\/package\/((?:@[^/?#]+\/)?[^/?#]+)/i)
  return m ? decodeURIComponent(m[1]) : null
}
