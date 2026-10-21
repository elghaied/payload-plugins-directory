import type { Payload } from 'payload'
import { ValidationError } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import type { GitHubAuthClient } from '@/lib/github/client'
import { relationId } from '@/lib/relationId'
import type { Repository } from '@/payload-types'
import { CLAIM_RECHECK_BUDGET_WINDOW_MS, CLAIM_RECHECK_COOLDOWN_MS, MAX_PENDING_PER_MAINTAINER } from './limits'
import { MESSAGES } from './messages'
import { normalizeNote, validationMessage } from './submit'

export type ClaimResult =
  | { status: 'claimed' | 'queued' | 'already' | 'pending' | 'not_found' }
  | { status: 'invalid'; message: string }

/** The only GitHub calls a claim needs. All are non-throwing by contract; callers still guard against a misbehaving client. */
export type ClaimGitHub = Pick<GitHubAuthClient, 'getRepositoryById' | 'getUserById' | 'checkPublicOrgMembership'> & Partial<Pick<GitHubAuthClient, 'isRateLimited'>>

const OFFICIAL_OWNER = 'payloadcms'

/** What the official rule reads; plugins and templates both have it. */
type OfficialFlags = { isOfficial?: boolean | null; source?: string | null }

/** Official plugins and templates (the `payloadcms` org) are always reviewed by an admin (ruling F25). */
function isOfficial(plugin: OfficialFlags, repository: Pick<Repository, 'fullName' | 'owner'>): boolean {
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
  /** The listing being claimed: a plugin or a template. */
  plugin: OfficialFlags
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

export type ClaimKind = 'plugin' | 'template'

/** Plugin claims keep their exact behaviour: a thin wrapper over `claimListing`. */
export function claimPlugin(args: { payload: Payload; maintainer: CurrentMaintainer; slug: string; note: string; github: ClaimGitHub }): Promise<ClaimResult> {
  return claimListing({ ...args, kind: 'plugin' })
}

/**
 * Claims a listed plugin or template. Same rules, cap and cooldowns for both kinds; official listings are never instant.
 * A claim submission links the listing through `plugin` or `template` (by kind), never both.
 */
export async function claimListing({
  payload,
  maintainer,
  kind,
  slug,
  note,
  github,
}: {
  payload: Payload
  maintainer: CurrentMaintainer
  kind: ClaimKind
  slug: string
  note: string
  github: ClaimGitHub
}): Promise<ClaimResult> {
  const relation = kind === 'template' ? 'template' : 'plugin'
  // As the maintainer: only listed, non-trashed listings are visible.
  const found = await payload.find({
    collection: kind === 'template' ? 'templates' : 'plugins',
    overrideAccess: false,
    user: maintainer,
    depth: 1,
    limit: 1,
    where: { slug: { equals: slug } },
  })
  const listing = found.docs[0]
  if (!listing || typeof listing.repository !== 'object' || listing.repository === null) return { status: 'not_found' }
  if ((listing.maintainers ?? []).map(relationId).includes(maintainer.id)) return { status: 'already' }
  const link = kind === 'template' ? { template: listing.id } : { plugin: listing.id }

  const onError = (err: unknown) => payload.logger.warn({ err }, 'claim: ownership check failed; queueing for review')
  const own = await payload.find({
    collection: 'submissions',
    overrideAccess: false,
    user: maintainer,
    depth: 0,
    limit: 1,
    where: { and: [{ type: { equals: 'claim' } }, { [relation]: { equals: listing.id } }, { status: { equals: 'pending' } }] },
  })
  const existing = own.docs[0]
  if (existing) {
    // The maintainer's own pending claim (queued earlier, e.g. during a GitHub outage). The cap does not apply to
    // re-checking it. If ownership is now confirmed, approve THAT claim through the normal approval path (system write:
    // maintainers cannot update submissions); otherwise it stays pending. No duplicate row is ever created.
    // Cooldown, counted from the last check (or creation, which itself ran one). Inside the window: neutral `pending`, no GitHub call.
    const lastCheck = Date.parse(existing.lastClaimCheckAt ?? existing.createdAt)
    if (!Number.isFinite(lastCheck) || Date.now() - lastCheck < CLAIM_RECHECK_COOLDOWN_MS) return { status: 'pending' }
    // Per-maintainer budget: one re-check across ALL of this maintainer's claims per window (many pending claims must not
    // multiply GitHub calls). Skipped re-checks do not consume it.
    const recent = await payload.count({
      collection: 'submissions', overrideAccess: false, user: maintainer,
      where: { and: [
        { type: { equals: 'claim' } },
        { submittedBy: { equals: maintainer.id } },
        { lastClaimCheckAt: { greater_than: new Date(Date.now() - CLAIM_RECHECK_BUDGET_WINDOW_MS).toISOString() } },
      ] },
    })
    if (recent.totalDocs > 0) return { status: 'pending' }
    // No web token and the shared unauthenticated quota is exhausted: re-checking would only fail. Stay pending, spend nothing.
    if (github.isRateLimited?.()) return { status: 'pending' }
    // Stamp BEFORE calling GitHub so a slow or failing check still counts (system write: the field is admin-only).
    await payload.update({ collection: 'submissions', id: existing.id, overrideAccess: true, depth: 0, data: { lastClaimCheckAt: new Date().toISOString() } })
    if (!(await isInstantClaim({ github, maintainer, plugin: listing, repository: listing.repository, onError }))) return { status: 'pending' }
    try {
      await payload.update({ collection: 'submissions', id: existing.id, overrideAccess: true, depth: 0, data: { status: 'approved' } })
      return { status: 'claimed' }
    } catch (err) {
      if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
      throw err
    }
  }

  // Cap BEFORE any GitHub call (F24): an account at the cap must not be able to spend the shared unauthenticated quota.
  const pendingTotal = await payload.count({
    collection: 'submissions',
    overrideAccess: false,
    user: maintainer,
    where: { status: { equals: 'pending' } },
  })
  if (pendingTotal.totalDocs >= MAX_PENDING_PER_MAINTAINER) return { status: 'invalid', message: MESSAGES.tooMany }

  const instant = await isInstantClaim({ github, maintainer, plugin: listing, repository: listing.repository, onError })

  try {
    if (instant) {
      // System write: an approved claim record is the audit trail, and Task 10's approval hook adds the maintainer
      // through `addMaintainer`. Maintainers cannot create approved submissions themselves. No `context` flags: Payload v4
      // merges context into the shared `req.context`, and the listing revalidate hook skips maintainers-only changes itself.
      await payload.create({
        collection: 'submissions',
        overrideAccess: true,
        depth: 0,
        data: { type: 'claim', kind, ...link, submittedBy: maintainer.id, status: 'approved', note: normalizeNote(note) },
      })
      return { status: 'claimed' }
    }
    await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainer,
      depth: 0,
      data: { type: 'claim', kind, ...link, submittedBy: maintainer.id, status: 'pending', note: normalizeNote(note) },
    })
    return { status: 'queued' }
  } catch (err) {
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
}
