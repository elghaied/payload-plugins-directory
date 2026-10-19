import type { NpmData } from '@/types'
import { HttpError, RateLimitError, rateLimitResetAt, type FetchFn } from './http'

export const NPM_REGISTRY = 'https://registry.npmjs.org'
export const NPM_DOWNLOADS = 'https://api.npmjs.org/downloads/point'

/** Untrusted package name (it comes from other repos' package.json). */
export class InvalidNpmPackageNameError extends Error {
  constructor(value: string) {
    super(`Invalid npm package name: ${JSON.stringify(value)}`)
    this.name = 'InvalidNpmPackageNameError'
  }
}

// Lowercase url-safe segments, no leading `.`/`_`, optional `@scope/` prefix.
const PACKAGE_NAME = /^(?:@[a-z0-9~-][a-z0-9._~-]*\/)?[a-z0-9~-][a-z0-9._~-]*$/

function checkPackageName(name: string): string {
  if (typeof name !== 'string' || name.length > 214 || !PACKAGE_NAME.test(name)) {
    throw new InvalidNpmPackageNameError(String(name))
  }
  return name
}

/** Builds the URL and asserts it still points at the expected npm host. */
function buildUrl(base: string, path: string): string {
  const url = `${base}/${path}`
  if (new URL(url).origin !== new URL(base).origin) throw new Error(`Unexpected npm URL origin: ${url}`)
  return url
}

export type NpmPackageInfo = { data: NpmData; repositoryUrl: string | null }

export interface NpmClient {
  /** null when the package does not exist or has no `latest` tag. Rate limits throw RateLimitError, other failures HttpError. */
  getPackage(name: string): Promise<NpmPackageInfo | null>
}

type RepositoryField = string | { url?: string } | undefined
type RegistryDoc = {
  'dist-tags'?: { latest?: string }
  time?: Record<string, string>
  repository?: RepositoryField
  versions?: Record<string, { dependencies?: Record<string, string>; dist?: { unpackedSize?: number }; repository?: RepositoryField }>
}

const repositoryUrl = (r: RepositoryField): string | null => (typeof r === 'string' ? r : r?.url) ?? null

export function createNpmClient(opts: { fetch: FetchFn; now?: () => Date }): NpmClient {
  const now = opts.now ?? (() => new Date())

  async function get(url: string): Promise<Response | null> {
    const res = await opts.fetch(url)
    const resetAt = rateLimitResetAt(res, now())
    if (resetAt) throw new RateLimitError('npm', resetAt)
    if (res.status === 404) return null
    if (!res.ok) throw new HttpError(res.status, url)
    return res
  }

  /** A package with no download stats (404) or an unparseable body counts as 0; every other failure throws so a transient error never records 0. */
  async function downloads(url: string): Promise<number> {
    const res = await get(url)
    if (!res) return 0
    const text = await res.text() // body-read (network) errors propagate
    try {
      const body = JSON.parse(text) as { downloads?: unknown }
      return typeof body?.downloads === 'number' && Number.isFinite(body.downloads) ? body.downloads : 0
    } catch {
      return 0
    }
  }

  return {
    async getPackage(name) {
      const id = encodeURIComponent(checkPackageName(name))
      const [metaRes, weeklyDownloads, monthlyDownloads] = await Promise.all([
        get(buildUrl(NPM_REGISTRY, id)),
        downloads(buildUrl(NPM_DOWNLOADS, `last-week/${id}`)),
        downloads(buildUrl(NPM_DOWNLOADS, `last-month/${id}`)),
      ])
      if (!metaRes) return null
      const text = await metaRes.text() // body-read (network) errors propagate
      let meta: RegistryDoc
      try {
        meta = JSON.parse(text) as RegistryDoc
      } catch {
        throw new HttpError(metaRes.status, buildUrl(NPM_REGISTRY, id)) // malformed registry JSON
      }
      if (!meta || typeof meta !== 'object') throw new HttpError(metaRes.status, buildUrl(NPM_REGISTRY, id))
      const latest = meta['dist-tags']?.latest
      if (!latest) return null
      const version = meta.versions?.[latest]
      return {
        data: {
          weeklyDownloads,
          monthlyDownloads,
          latestVersion: latest,
          unpackedSize: version?.dist?.unpackedSize ?? null,
          lastPublish: meta.time?.[latest] ?? '',
          dependencyCount: Object.keys(version?.dependencies ?? {}).length,
        },
        repositoryUrl: repositoryUrl(version?.repository) ?? repositoryUrl(meta.repository),
      }
    },
  }
}
