import type { Payload, PayloadRequest, Where } from 'payload'
import { MAX_PENDING_PER_MAINTAINER } from './limits'
import type { SubmissionTarget, TemplateSubmissionTarget } from './url'

export { MAX_PENDING_PER_MAINTAINER }

export type ListingKind = 'plugin' | 'template'

export type ListingConflict =
  | { kind: 'listed'; slug: string; name: string }
  | { kind: 'unavailable' }
  | { kind: 'pending' }
  | { kind: 'otherType'; existingType: ListingKind; slug: string; name: string }

type ListingRow = { id: number; slug: string; name: string; visibility: 'listed' | 'hidden' }
type PluginRow = ListingRow

/** `path` of a repository-root listing is stored as null (or, for older rows, ''). */
export function listingPathWhere(path: string | null): Where {
  return path ? { path: { equals: path } } : { or: [{ path: { exists: false } }, { path: { equals: '' } }] }
}

/**
 * Repository ids whose fullName equals `fullName`, ignoring case (GitHub names are case-insensitive).
 * `like` is a case-insensitive contains match, used only to narrow the candidates; it is not paginated away
 * (`pagination: false`), so the exact comparison always sees every candidate, however many similar names exist.
 */
export async function findRepositoryIds(payload: Payload, fullName: string, req?: PayloadRequest): Promise<number[]> {
  const wanted = fullName.toLowerCase()
  const res = await payload.find({
    collection: 'repositories',
    where: { fullName: { like: fullName } },
    select: { fullName: true },
    depth: 0,
    pagination: false,
    overrideAccess: true, // system lookup; repositories are public anyway
    req,
  })
  return res.docs.filter((r) => r.fullName.toLowerCase() === wanted).map((r) => r.id)
}

/** Non-trashed plugins already in the directory for this target (listed or hidden). */
async function findKnownPlugins(payload: Payload, target: SubmissionTarget, req?: PayloadRequest): Promise<PluginRow[]> {
  const select = { slug: true, name: true, visibility: true } as const
  if (target.kind === 'npm') {
    const res = await payload.find({
      collection: 'plugins', where: { packageName: { equals: target.packageName } }, select, depth: 0, limit: 10, sort: 'id', overrideAccess: true, req,
    })
    return res.docs as PluginRow[]
  }
  const repoIds = await findRepositoryIds(payload, target.fullName, req)
  if (!repoIds.length) return []
  const res = await payload.find({
    collection: 'plugins', where: { repository: { in: repoIds } }, select, depth: 0, limit: 50, sort: 'id', overrideAccess: true, req,
  })
  return res.docs as PluginRow[]
}

/** Non-trashed rows of `collection` on the repository `fullName` at `path` (null = the repository root). */
async function findAtPath(
  payload: Payload,
  collection: 'plugins' | 'templates',
  fullName: string,
  path: string | null,
  req?: PayloadRequest,
): Promise<ListingRow[]> {
  const repoIds = await findRepositoryIds(payload, fullName, req)
  if (!repoIds.length) return []
  const res = await payload.find({
    collection,
    where: { and: [{ repository: { in: repoIds } }, listingPathWhere(path)] },
    select: { slug: true, name: true, visibility: true },
    depth: 0,
    limit: 50,
    sort: 'id',
    overrideAccess: true, // system lookup across visibilities; trashed rows are excluded by default
    req,
  })
  return res.docs as ListingRow[]
}

/** The non-trashed template of `fullName` at `path`, listed or hidden. */
export async function findTemplateForRepositoryPath(payload: Payload, fullName: string, path: string | null, req?: PayloadRequest) {
  const templates = await findAtPath(payload, 'templates', fullName, path, req)
  return templates[0] ? { id: templates[0].id, slug: templates[0].slug } : null
}

/** A listed row is named; a hidden (blocklisted) one is reported as unavailable without revealing it. */
function existing(rows: ListingRow[]): { kind: 'listed'; slug: string; name: string } | { kind: 'unavailable' } | null {
  const listed = rows.find((r) => r.visibility === 'listed')
  if (listed) return { kind: 'listed', slug: listed.slug, name: listed.name }
  return rows.length ? { kind: 'unavailable' } : null
}

function asOtherType(found: ReturnType<typeof existing>, existingType: ListingKind): ListingConflict | null {
  if (found?.kind === 'listed') return { kind: 'otherType', existingType, slug: found.slug, name: found.name }
  return found
}

export async function findPluginForRepository(payload: Payload, fullName: string, req?: PayloadRequest) {
  const plugins = await findKnownPlugins(payload, { kind: 'github', fullName, canonicalUrl: '' }, req)
  return plugins[0] ? { id: plugins[0].id, slug: plugins[0].slug } : null
}

/**
 * Why a listing submission for `target` must not be created, or null.
 * - listed: a visible listing of the same kind exists (UI links to it).
 * - unavailable: a hidden (blocklisted) listing of either kind exists; its slug is not revealed.
 * - otherType: the repository (root, or the template's folder) is already listed as the other kind. One repository
 *   path is never both a plugin and a template.
 * - pending: an open submission of the same kind exists (pending, or approved but not yet synced).
 * Trashed rows do not block: a vanished repository may come back through a submission.
 */
export async function findListingConflict(
  payload: Payload,
  target: SubmissionTarget,
  req?: PayloadRequest,
  kind?: 'plugin',
): Promise<ListingConflict | null>
export async function findListingConflict(
  payload: Payload,
  target: TemplateSubmissionTarget,
  req: PayloadRequest | undefined,
  kind: 'template',
): Promise<ListingConflict | null>
export async function findListingConflict(
  payload: Payload,
  target: SubmissionTarget | TemplateSubmissionTarget,
  req?: PayloadRequest,
  kind: ListingKind = 'plugin',
): Promise<ListingConflict | null> {
  if (kind === 'template') return findTemplateConflict(payload, target as TemplateSubmissionTarget, req)
  const plugin = target as SubmissionTarget
  const same = existing(await findKnownPlugins(payload, plugin, req))
  if (same) return same
  // A plugin is the whole repository: it collides with a template at the repository root.
  if (plugin.kind === 'github') {
    const other = asOtherType(existing(await findAtPath(payload, 'templates', plugin.fullName, null, req)), 'template')
    if (other) return other
  }

  const sameTarget: Where[] = [
    { url: { equals: plugin.canonicalUrl } },
    ...(plugin.kind === 'github' ? [{ repositoryFullName: { equals: plugin.fullName } }] : []),
  ]
  const open = await payload.count({
    collection: 'submissions',
    overrideAccess: true, // must see every maintainer's submissions to detect duplicates
    req,
    where: {
      and: [
        { type: { equals: 'listing' } },
        { kind: { equals: 'plugin' } },
        { or: sameTarget },
        { or: [{ status: { equals: 'pending' } }, { and: [{ status: { equals: 'approved' } }, { plugin: { exists: false } }] }] },
      ],
    },
  })
  return open.totalDocs ? { kind: 'pending' } : null
}

async function findTemplateConflict(payload: Payload, target: TemplateSubmissionTarget, req?: PayloadRequest): Promise<ListingConflict | null> {
  const same = existing(await findAtPath(payload, 'templates', target.fullName, target.path, req))
  if (same) return same
  const other = asOtherType(existing(await findAtPath(payload, 'plugins', target.fullName, target.path, req)), 'plugin')
  if (other) return other

  const open = await payload.count({
    collection: 'submissions',
    overrideAccess: true, // must see every maintainer's submissions to detect duplicates
    req,
    where: {
      and: [
        { type: { equals: 'listing' } },
        { kind: { equals: 'template' } },
        {
          or: [
            { url: { equals: target.canonicalUrl } },
            { and: [{ repositoryFullName: { equals: target.fullName } }, listingPathWhere(target.path)] },
          ],
        },
        { or: [{ status: { equals: 'pending' } }, { and: [{ status: { equals: 'approved' } }, { template: { exists: false } }] }] },
      ],
    },
  })
  return open.totalDocs ? { kind: 'pending' } : null
}
