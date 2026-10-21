import type { Payload, PayloadRequest } from 'payload'
import { relationId } from '@/lib/relationId'
import { QUEUES } from '@/sync/queues'

export type ConvertResult = { status: 'converted'; templateSlug: string } | { status: 'exists'; templateSlug: string } | { status: 'missing' }

/**
 * Admin "Convert to template": the plugin's listing becomes a template listing of the same repository and path.
 * Everything goes through `req` (one transaction, no `context` flags, which Payload v4 merges into the shared request
 * context). The plugin is trashed here as an admin decision (`syncTrashReason` null): sync never restores it, and
 * sync-repository's template-path guard never re-extracts it. Order: read, exists-check, trash, create, queue.
 * The Plugins and Templates hooks queue the revalidation of both slugs' tags (one job each) through the same `req`.
 */
export async function convertPluginToTemplate(payload: Payload, pluginId: number | string, req: PayloadRequest): Promise<ConvertResult> {
  const plugin = await payload
    .findByID({ collection: 'plugins', id: pluginId, overrideAccess: true, depth: 0, disableErrors: true, req })
    .catch(() => null)
  if (!plugin || plugin.deletedAt) return { status: 'missing' }

  const repositoryId = relationId(plugin.repository)
  if (repositoryId === undefined) return { status: 'missing' }
  const path = plugin.path ?? ''

  const held = await payload.find({
    collection: 'templates', overrideAccess: true, depth: 0, limit: 1, pagination: false, req,
    where: { repository: { equals: repositoryId } }, select: { slug: true, path: true },
  })
  const existing = held.docs.find((t) => (t.path ?? '') === path)
  if (existing) return { status: 'exists', templateSlug: existing.slug }

  await payload.update({
    collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 0, req,
    data: { deletedAt: new Date().toISOString(), syncTrashReason: null },
  })

  const template = await payload.create({
    collection: 'templates', overrideAccess: true, depth: 0, req,
    data: {
      slug: plugin.slug,
      name: plugin.name,
      repository: repositoryId,
      path: plugin.path,
      url: plugin.url,
      description: plugin.description,
      readme: plugin.readme,
      readmeTruncated: plugin.readmeTruncated,
      maintainers: (plugin.maintainers ?? []).map(relationId).filter((id): id is number => id !== undefined),
      customTagline: plugin.customTagline,
      _h_tags: plugin._h_tags,
      visibility: plugin.visibility,
      firstSeenAt: plugin.firstSeenAt,
      source: 'converted',
      isOfficial: false,
      contentHash: null, // the next sync and enrichment refresh it
    } as never,
  })

  const repo = await payload.findByID({ collection: 'repositories', id: repositoryId, overrideAccess: true, depth: 0, req })
  await payload.jobs.queue({
    task: 'sync-template',
    input: { fullName: repo.fullName, githubId: repo.githubId ?? null, path: plugin.path ?? null, source: 'converted' },
    queue: QUEUES.sync, overrideAccess: true, req,
  })
  return { status: 'converted', templateSlug: template.slug }
}
