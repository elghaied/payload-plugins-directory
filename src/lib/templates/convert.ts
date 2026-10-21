import type { Payload, PayloadRequest } from 'payload'
import { relationId } from '@/lib/relationId'
import { QUEUES } from '@/sync/queues'

export type ConvertResult =
  | { status: 'converted'; templateSlug: string }
  | { status: 'exists'; templateSlug: string }
  /** A template (trashed or not) already uses the plugin's slug, so the copy cannot be created. */
  | { status: 'slug-taken'; templateSlug: string }
  | { status: 'missing' }

/**
 * Admin "Convert to template": the plugin's listing becomes a template listing of the same repository and path.
 * Everything goes through `req` (one transaction, no `context` flags, which Payload v4 merges into the shared request
 * context). The plugin is trashed here as an admin decision (`syncTrashReason` null): sync never restores it, and
 * sync-repository's template-path guard never re-extracts it. Order: read, exists-check, trash, create, queue.
 * The Plugins and Templates hooks queue the revalidation of both slugs' tags (one job each) through the same `req`.
 */
export async function convertPluginToTemplate(payload: Payload, pluginId: number | string, req: PayloadRequest): Promise<ConvertResult> {
  // disableErrors turns only a genuine not-found into null; any other (database) error propagates.
  const plugin = await payload.findByID({ collection: 'plugins', id: pluginId, overrideAccess: true, depth: 0, disableErrors: true, req })
  if (!plugin || plugin.deletedAt) return { status: 'missing' }

  const repositoryId = relationId(plugin.repository)
  if (repositoryId === undefined) return { status: 'missing' }
  const path = plugin.path ?? ''

  const existing = (
    await payload.find({
      collection: 'templates', overrideAccess: true, depth: 0, limit: 1, pagination: false, req,
      where: {
        and: [
          { repository: { equals: repositoryId } },
          path ? { path: { equals: path } } : { or: [{ path: { exists: false } }, { path: { equals: '' } }] },
        ],
      },
      select: { slug: true },
    })
  ).docs[0]
  if (existing) return { status: 'exists', templateSlug: existing.slug }

  // The slug is unique across trashed templates too: say so up front instead of failing the create.
  const taken = (
    await payload.find({
      collection: 'templates', overrideAccess: true, depth: 0, limit: 1, pagination: false, trash: true, req,
      where: { slug: { equals: plugin.slug } }, select: { slug: true },
    })
  ).docs[0]
  if (taken) return { status: 'slug-taken', templateSlug: taken.slug }

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
