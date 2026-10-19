import { createHash } from 'node:crypto'

/**
 * Hash of the author-controlled content enrichment reads (spec §3.1: README + package.json + description).
 * Phase 2 re-enriches a plugin when this differs from `ai.enrichedHash`.
 */
export function computeContentHash(p: {
  readme?: string | null
  packageJsonText?: string | null
  description?: string | null
}): string {
  return createHash('sha256')
    .update(JSON.stringify([p.readme ?? '', p.packageJsonText ?? '', p.description ?? '']))
    .digest('hex')
}
