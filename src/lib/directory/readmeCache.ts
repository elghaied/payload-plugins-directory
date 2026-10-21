import { createHash } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import type { Root } from 'hast'
import { pluginTag } from '@/lib/cacheTags'
import type { RepoRef } from './markdown'
import { README_RENDER_VERSION, renderReadmeTree } from './readmeTree'

export type CachedReadme = { tree: Root | null }

/**
 * The rendered README tree, computed once per README version: keyed by slug + a hash of the text and repository
 * reference, tagged `plugin:<slug>` so a plugin revalidation also drops it. null tree = show plain text.
 */
export function getReadmeTree(slug: string, source: string, repo: RepoRef): Promise<CachedReadme> {
  const hash = createHash('sha256')
    .update(JSON.stringify([source, repo.fullName, repo.defaultBranch ?? null, repo.path ?? null]))
    .digest('hex')
    .slice(0, 32)
  return unstable_cache(async (): Promise<CachedReadme> => ({ tree: renderReadmeTree(source, repo) }), ['readme-tree', README_RENDER_VERSION, slug, hash], {
    tags: [pluginTag(slug)],
  })()
}
