import type { Payload } from 'payload'
import { ValidationError } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import type { GitHubAuthClient } from '@/lib/github/client'
import { relationId } from '@/lib/relationId'
import type { Plugin, Repository } from '@/payload-types'
import { MAX_PENDING_PER_MAINTAINER } from './limits'
import { MESSAGES } from './messages'
import { normalizeNote, validationMessage } from './submit'

export type ClaimResult =
  | { status: 'claimed' | 'queued' | 'already' | 'pending' | 'not_found' }
  | { status: 'invalid'; message: string }

/** The only GitHub calls a claim needs. All are non-throwing by contract; callers still guard against a misbehaving client. */
export type ClaimGitHub = Pick<GitHubAuthClient, 'getRepositoryById' | 'getUserById' | 'checkPublicOrgMembership'>

const OFFICIAL_OWNER = 'payloadcms'

/** Official plugins (the `payloadcms` org) are always reviewed by an admin (ruling F25). */
function isOfficial(plugin: Pick<Plugin, 'isOfficial' | 'source'>, repository: Pick<Repository, 'fullName' | 'owner'>): boolean {
  return (
    plugin.isOfficial === true ||
    plugin.source === 'official' ||
    repository.owner.toLowerCase() === OFFICIAL_OWNER ||
    repository.fullName.toLowerCase().startsWith(`${OFFICIAL_OWNER}/`)
  )
}

/**
 * Spec §6 with the F7 identity ruling: instant only on a LIVE, numeric-id match. Login strings are never compared.
 *  - The repository is read from GitHub by its stored numeric id (`/repositories/{id}`: survives renames and transfers).
 *  - User-owned: instant only when `owner.id === maintainer.githubId`.
 *  - Org-owned: instant only when the PUBLIC members API answers an explicit "member" for the maintainer's CURRENT login,
 *    which comes from `GET /user/{githubId}` (the stored login can be stale, and logins get recycled).
 * Everything else (official plugin, missing id, 403/429 rate limit, 404, outage, unexpected shape, a thrown error) is
 * `false`: the claim is queued, never denied and never an error.
 */
export async function isInstantClaim({
  github,
  maintainer,
  plugin,
  repository,
  onError,
}: {
  github: ClaimGitHub
  maintainer: Pick<CurrentMaintainer, 'githubId'>
  plugin: Pick<Plugin, 'isOfficial' | 'source'>
  repository: Pick<Repository, 'githubId' | 'fullName' | 'owner'>
  onError?: (err: unknown) => void
}): Promise<boolean> {
  try {
    if (isOfficial(plugin, repository)) return false
    const maintainerGithubId = maintainer.githubId
    const repositoryGithubId = repository.githubId
    if (typeof maintainerGithubId !== 'number' || !Number.isSafeInteger(maintainerGithubId) || maintainerGithubId <= 0) return false
    if (typeof repositoryGithubId !== 'number' || !Number.isSafeInteger(repositoryGithubId) || repositoryGithubId <= 0) return false

    const live = await github.getRepositoryById(repositoryGithubId)
    if (!live.ok || live.repository.id !== repositoryGithubId) return false
    const owner = live.repository.owner
    // The live owner may differ from the synced one (transfer): re-apply the official rule to what GitHub says now.
    if (owner.login.toLowerCase() === OFFICIAL_OWNER) return false

    if (owner.type === 'User') return owner.id === maintainerGithubId
    if (owner.type !== 'Organization') return false

    const user = await github.getUserById(maintainerGithubId)
    if (!user.ok || user.user.id !== maintainerGithubId) return false
    const membership = await github.checkPublicOrgMembership(owner.login, user.user.login)
    return membership.ok && membership.member === true
  } catch (err) {
    onError?.(err)
    return false
  }
}

export async function claimPlugin({
  payload,
  maintainer,
  slug,
  note,
  github,
}: {
  payload: Payload
  maintainer: CurrentMaintainer
  slug: string
  note: string
  github: ClaimGitHub
}): Promise<ClaimResult> {
  // As the maintainer: only listed, non-trashed plugins are visible.
  const found = await payload.find({
    collection: 'plugins',
    overrideAccess: false,
    user: maintainer,
    depth: 1,
    limit: 1,
    where: { slug: { equals: slug } },
  })
  const plugin = found.docs[0]
  if (!plugin || typeof plugin.repository !== 'object' || plugin.repository === null) return { status: 'not_found' }
  if ((plugin.maintainers ?? []).map(relationId).includes(maintainer.id)) return { status: 'already' }

  const open = await payload.count({
    collection: 'submissions',
    overrideAccess: false,
    user: maintainer,
    where: { and: [{ type: { equals: 'claim' } }, { plugin: { equals: plugin.id } }, { status: { equals: 'pending' } }] },
  })
  if (open.totalDocs) return { status: 'pending' }

  // Cap BEFORE any GitHub call (F24): an account at the cap must not be able to spend the shared unauthenticated quota.
  const pendingTotal = await payload.count({
    collection: 'submissions',
    overrideAccess: false,
    user: maintainer,
    where: { status: { equals: 'pending' } },
  })
  if (pendingTotal.totalDocs >= MAX_PENDING_PER_MAINTAINER) return { status: 'invalid', message: MESSAGES.tooMany }

  const instant = await isInstantClaim({
    github,
    maintainer,
    plugin,
    repository: plugin.repository,
    onError: (err) => payload.logger.warn({ err }, 'claim: ownership check failed; queueing for review'),
  })

  try {
    if (instant) {
      // System write: an approved claim record is the audit trail, and Task 10's approval hook adds the maintainer
      // through `addMaintainer`. Maintainers cannot create approved submissions themselves. No `context` flags: Payload v4
      // merges context into the shared `req.context`, and the plugin revalidate hook skips maintainers-only changes itself.
      await payload.create({
        collection: 'submissions',
        overrideAccess: true,
        depth: 0,
        data: { type: 'claim', plugin: plugin.id, submittedBy: maintainer.id, status: 'approved', note: normalizeNote(note) },
      })
      return { status: 'claimed' }
    }
    await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainer,
      depth: 0,
      data: { type: 'claim', plugin: plugin.id, submittedBy: maintainer.id, status: 'pending', note: normalizeNote(note) },
    })
    return { status: 'queued' }
  } catch (err) {
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
}
