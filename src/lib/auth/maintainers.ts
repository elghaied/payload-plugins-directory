import type { Payload } from 'payload'
import type { GitHubUser } from '@/lib/github/client'
import type { Maintainer } from '@/payload-types'
import { clampChars } from '@/sync/limits'
import { revokeSessionsNow } from './strategy'

const LOGIN_MAX_CHARS = 100
const NAME_MAX_CHARS = 200
const AVATAR_MAX_CHARS = 500

/**
 * System write: identity fields are admin-only, so the sign-in callback bypasses access control on purpose.
 * Keyed by the immutable numeric GitHub id (never the login). A blocked maintainer is returned untouched
 * so the caller can refuse the sign-in; nothing is ever re-created for them.
 * Maintainers has no revalidate hook and no plugin relationship is touched, so there is nothing to revalidate.
 */
export async function upsertMaintainer(payload: Payload, gh: GitHubUser): Promise<Maintainer> {
  const data = {
    login: clampChars(gh.login, LOGIN_MAX_CHARS),
    name: gh.name === null ? null : clampChars(gh.name, NAME_MAX_CHARS),
    avatarUrl: gh.avatarUrl === null ? null : clampChars(gh.avatarUrl, AVATAR_MAX_CHARS),
  }
  const find = async () =>
    (
      await payload.find({
        collection: 'maintainers',
        where: { githubId: { equals: gh.id } },
        limit: 1,
        depth: 0,
        overrideAccess: true,
      })
    ).docs[0]

  const update = (existing: Maintainer) =>
    existing.blocked
      ? existing
      : payload.update({ collection: 'maintainers', id: existing.id, data, depth: 0, overrideAccess: true })

  const existing = await find()
  if (existing) return update(existing)
  try {
    return await payload.create({ collection: 'maintainers', data: { githubId: gh.id, ...data }, depth: 0, overrideAccess: true })
  } catch (err) {
    // Two first sign-ins racing on the unique githubId: the loser updates the winner's row.
    const raced = await find()
    if (raced) return update(raced)
    throw err
  }
}

/** Invalidates every session issued so far for this maintainer (logout everywhere). System write. */
export async function revokeMaintainerSessions(payload: Payload, maintainerId: number, now?: Date): Promise<void> {
  await payload.update({
    collection: 'maintainers',
    id: maintainerId,
    data: { sessionsValidAfter: revokeSessionsNow(now).toISOString() },
    depth: 0,
    overrideAccess: true,
  })
}
