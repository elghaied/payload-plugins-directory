import { NextResponse, type NextRequest } from 'next/server'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { NO_STORE } from '@/lib/auth/http'
import { revokeMaintainerSessions } from '@/lib/auth/maintainers'
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session'
import { GITHUB_SESSION_STRATEGY, githubSessionStrategy, isCrossOriginWrite } from '@/lib/auth/strategy'
import { getServerURL } from '@/lib/serverUrl'

export const dynamic = 'force-dynamic'

/**
 * POST only, from the account menu form; 303 so the browser follows with a GET. Signs out everywhere.
 *
 * Deliberate deviation from F11 (approved): with no SERVER_URL this answers 503 and does NOT clear the cookie.
 * Without it the cross-origin check is a no-op, so a relative redirect would make forced logout CSRF-able again.
 */
export async function POST(request: NextRequest) {
  const origin = getServerURL()
  if (!origin) return new NextResponse('Sign-out is not configured.', { status: 503, headers: NO_STORE })
  // A cross-site form must not be able to force a sign-out.
  if (isCrossOriginWrite(request.method, request.headers.get('origin'), origin)) {
    return new NextResponse('Forbidden', { status: 403, headers: NO_STORE })
  }

  let incomplete = false
  if (request.cookies.has(SESSION_COOKIE)) {
    let payload: Payload | undefined
    try {
      payload = await getPayload({ config: await config })
      // The strategy does the system lookup (overrideAccess) and the signature, expiry, githubId, blocked and
      // revocation checks, so a token can only ever revoke the maintainer it genuinely belongs to.
      const { user } = await githubSessionStrategy.authenticate({
        headers: request.headers,
        payload,
        strategyName: GITHUB_SESSION_STRATEGY,
      })
      if (user?.collection === 'maintainers') await revokeMaintainerSessions(payload, Number(user.id))
    } catch (err) {
      incomplete = true
      const reason = err instanceof Error ? err.name : 'unknown'
      if (payload) payload.logger.error({ reason }, 'logout: session revocation failed')
      else console.error('logout: session revocation failed', reason)
    }
  }

  // The cookie is cleared either way; a failed revocation is surfaced rather than reported as success.
  const target = incomplete ? '/auth/error?reason=logout_incomplete' : '/'
  const res = NextResponse.redirect(new URL(target, origin), { status: 303, headers: NO_STORE })
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return res
}
