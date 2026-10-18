type Env = Record<string, string | undefined>

/**
 * Public origin of this deployment, read at runtime.
 *
 * `SERVER_URL` is server-only, so Next never inlines it and one image can serve
 * staging and production. `NEXT_PUBLIC_SITE_URL` is a local-dev fallback only.
 * Reading through the `env` parameter (not `process.env.X` literals) keeps Next's
 * build-time `NEXT_PUBLIC_*` inlining from freezing the fallback into the bundle.
 */
export function getServerURL(env: Env = process.env): string {
  return (env.SERVER_URL || env.NEXT_PUBLIC_SITE_URL || '').replace(/\/+$/, '')
}

export const PRODUCTION_HOST = 'payloaddirectory.dev'

/**
 * True only for the public production site. Anything else (staging, previews, local, unset)
 * must not be indexed, so a missing or malformed URL counts as non-production.
 */
export function isProductionSite(serverURL: string): boolean {
  try {
    return new URL(serverURL).hostname === PRODUCTION_HOST
  } catch {
    return false
  }
}
