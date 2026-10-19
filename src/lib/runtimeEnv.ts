import { isUsableSecret, MIN_SECRET_LENGTH } from './revalidate'
import { getServerURL, isProductionSite, PRODUCTION_HOST } from './serverUrl'

type Env = Record<string, string | undefined>
export type ProcessRole = 'web' | 'worker'

/** Production misconfigurations that otherwise fail silently; logged once per process start (Payload onInit). */
export function runtimeEnvWarnings(env: Env, role: ProcessRole): string[] {
  if (env.NODE_ENV !== 'production') return []
  const warnings: string[] = []
  const serverURL = getServerURL(env)
  if (!serverURL) {
    warnings.push('SERVER_URL is not set: Payload has no allowed origins, and every page is served with noindex.')
  } else if (!isProductionSite(serverURL)) {
    warnings.push(`SERVER_URL is ${serverURL}, not https://${PRODUCTION_HOST}: every page is served with noindex.`)
  }
  if (!env.REVALIDATE_SECRET) {
    warnings.push(
      role === 'web'
        ? 'REVALIDATE_SECRET is not set: /api/revalidate answers 503 and pages refresh only hourly.'
        : 'REVALIDATE_SECRET is not set: revalidate jobs fail and pages refresh only hourly.',
    )
  } else if (!isUsableSecret(env.REVALIDATE_SECRET)) {
    // Values are never logged.
    warnings.push(`REVALIDATE_SECRET is shorter than ${MIN_SECRET_LENGTH} characters: it is ignored, so revalidation fails closed.`)
  }
  if (role === 'worker') {
    if (!env.GITHUB_TOKEN) warnings.push('GITHUB_TOKEN is not set: unauthenticated GitHub allows 60 requests per hour, far too few for discover and sync.')
    if (!env.INTERNAL_WEB_URL) warnings.push('INTERNAL_WEB_URL is not set: revalidate jobs post to http://localhost:3000.')
    if (!env.ANTHROPIC_API_KEY) {
      warnings.push('ANTHROPIC_API_KEY is not set: AI enrichment is skipped; plugins keep their author description and stay "Uncategorized".')
    }
  }
  return warnings
}
