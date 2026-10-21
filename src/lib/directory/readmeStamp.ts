import { createHash } from 'node:crypto'

/** Short hash of the README text a render was made from. */
export function readmeTextHash(readme: string | null | undefined): string {
  return createHash('sha256').update(readme ?? '').digest('hex').slice(0, 12)
}

/**
 * What `plugins.readmeRenderVersion` stores: the pipeline version plus the hash of the README it rendered. A row is
 * current only when both match, so an edit of `readme` (by sync or an admin) makes its stored HTML stale by itself.
 */
export function readmeStamp(version: string, readme: string | null | undefined): string {
  return `${version}.${readmeTextHash(readme)}`
}

/** True when a stored stamp was made from exactly this README text (any pipeline version). */
export function stampMatchesText(stamp: string | null | undefined, readme: string | null | undefined): boolean {
  return Boolean(stamp) && (stamp as string).endsWith(`.${readmeTextHash(readme)}`)
}
