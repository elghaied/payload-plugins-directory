import { createHash } from 'node:crypto'

/**
 * Hash of the author-controlled content enrichment reads (spec §3.1). Phase 2 re-enriches a plugin when this
 * differs from `ai.enrichedHash`, so it covers only fields that change what enrichment would say:
 * - `packageName`         package.json `name`
 * - `description`         package.json `description` (or the repository description / fallback sync stores)
 * - `keywords`            package.json `keywords`, order-insensitive
 * - `payloadVersionRange` the payload peer/dependency range
 * - `readme`              the full README
 * Everything else in package.json (version, dependencies, scripts, ...) is left out on purpose: a version bump or a
 * dependency update must not trigger a new enrichment.
 */
export function computeContentHash(p: {
  packageName?: string | null
  description?: string | null
  keywords?: readonly string[] | null
  payloadVersionRange?: string | null
  readme?: string | null
}): string {
  const fields = [p.packageName ?? '', p.description ?? '', [...(p.keywords ?? [])].sort(), p.payloadVersionRange ?? '', p.readme ?? '']
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}
