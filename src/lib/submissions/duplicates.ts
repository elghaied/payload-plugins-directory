import type { Payload, PayloadRequest, Where } from 'payload'
import { MAX_PENDING_PER_MAINTAINER } from './limits'
import type { SubmissionTarget } from './url'

export { MAX_PENDING_PER_MAINTAINER }

export type ListingConflict = { kind: 'listed'; slug: string; name: string } | { kind: 'unavailable' } | { kind: 'pending' }

type PluginRow = { id: number; slug: string; name: string; visibility: 'listed' | 'hidden' }

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

export async function findPluginForRepository(payload: Payload, fullName: string, req?: PayloadRequest) {
  const plugins = await findKnownPlugins(payload, { kind: 'github', fullName, canonicalUrl: '' }, req)
  return plugins[0] ? { id: plugins[0].id, slug: plugins[0].slug } : null
}

/**
 * Why a listing submission for `target` must not be created, or null.
 * - listed: a visible plugin exists (UI links to it).
 * - unavailable: a hidden (blocklisted) plugin exists; its slug is not revealed.
 * - pending: an open submission exists (pending, or approved but not yet synced).
 * Trashed plugins do not block: a vanished repository may come back through a submission.
 */
export async function findListingConflict(payload: Payload, target: SubmissionTarget, req?: PayloadRequest): Promise<ListingConflict | null> {
  const plugins = await findKnownPlugins(payload, target, req)
  const listed = plugins.find((p) => p.visibility === 'listed')
  if (listed) return { kind: 'listed', slug: listed.slug, name: listed.name }
  if (plugins.length) return { kind: 'unavailable' }

  const sameTarget: Where[] = [
    { url: { equals: target.canonicalUrl } },
    ...(target.kind === 'github' ? [{ repositoryFullName: { equals: target.fullName } }] : []),
  ]
  const open = await payload.count({
    collection: 'submissions',
    overrideAccess: true, // must see every maintainer's submissions to detect duplicates
    req,
    where: {
      and: [
        { type: { equals: 'listing' } },
        { or: sameTarget },
        { or: [{ status: { equals: 'pending' } }, { and: [{ status: { equals: 'approved' } }, { plugin: { exists: false } }] }] },
      ],
    },
  })
  return open.totalDocs ? { kind: 'pending' } : null
}
