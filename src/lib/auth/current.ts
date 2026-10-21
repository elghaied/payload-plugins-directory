import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Maintainer } from '@/payload-types'
import { sanitizeReturnTo } from './oauth'
import { readCookie, SESSION_COOKIE } from './session'
import { GITHUB_SESSION_STRATEGY, githubSessionStrategy } from './strategy'

export type CurrentMaintainer = Maintainer & { collection: 'maintainers' }

/**
 * The signed-in maintainer for this request (RSC or server action). Resolved from the `pd_session` cookie through the
 * strategy directly, like /auth/session: `payload.auth` returns the FIRST strategy's user, so an admin session in the
 * same browser would hide the maintainer. It also skips the access-permission computation `payload.auth` does.
 */
export async function getCurrentMaintainer(): Promise<CurrentMaintainer | null> {
  const headerList = await headers()
  if (!readCookie(headerList, SESSION_COOKIE)) return null
  const payload = await getPayload({ config: await config })
  // Server actions are POSTs that carry `next-action`; the strategy's cross-origin check only applies to unsafe methods.
  const method = headerList.has('next-action') ? 'POST' : 'GET'
  const { user } = await githubSessionStrategy.authenticate({
    headers: headerList,
    payload,
    strategyName: GITHUB_SESSION_STRATEGY,
    req: { method, pathname: '/' } as never,
  } as never)
  return user?.collection === 'maintainers' ? (user as unknown as CurrentMaintainer) : null
}

export async function requireMaintainer(returnTo: string): Promise<CurrentMaintainer> {
  const maintainer = await getCurrentMaintainer()
  if (!maintainer) redirect(`/auth/github?returnTo=${encodeURIComponent(sanitizeReturnTo(returnTo))}`)
  return maintainer
}
