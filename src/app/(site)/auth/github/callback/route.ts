import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { exchangeCode, OAuthError } from '@/auth/githubOAuth'
import { upsertMaintainer } from '@/lib/auth/maintainers'
import {
  completeGitHubLogin,
  getOAuthConfig,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  oauthCookieOptions,
  type OAuthConfig,
} from '@/lib/auth/oauth'
import { getSessionSecret, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session'
import { createGitHubAuthClient } from '@/lib/github/client'
import { getServerURL } from '@/lib/serverUrl'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

function clearOAuthCookies(res: NextResponse) {
  res.cookies.set(OAUTH_STATE_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 })
  res.cookies.set(OAUTH_RETURN_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 })
  return res
}

export async function GET(request: NextRequest) {
  // Every URL comes from SERVER_URL; the request's own origin (Host header) is never trusted.
  const origin = getServerURL()
  if (!origin) return clearOAuthCookies(new NextResponse('GitHub sign-in is not configured.', { status: 503, headers: NO_STORE }))

  // `blocked` and `server_error` get the same generic message as an unknown reason.
  const fail = (reason: string) =>
    clearOAuthCookies(NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, origin), { headers: NO_STORE }))

  let oauth: OAuthConfig
  let secret: Uint8Array
  try {
    oauth = getOAuthConfig()
    secret = getSessionSecret()
  } catch {
    return fail('not_configured')
  }

  const payload = await getPayload({ config: await config })
  const params = request.nextUrl.searchParams
  const result = await completeGitHubLogin({
    code: params.get('code'),
    state: params.get('state'),
    error: params.get('error'),
    storedState: request.cookies.get(OAUTH_STATE_COOKIE)?.value,
    storedReturnTo: request.cookies.get(OAUTH_RETURN_COOKIE)?.value,
    config: oauth,
    exchange: ({ code, codeVerifier }) =>
      exchangeCode({ ...oauth, code, codeVerifier }, globalThis.fetch.bind(globalThis)),
    github: createGitHubAuthClient(),
    upsert: (user) => upsertMaintainer(payload, user),
    secret,
    // Never log the error object itself: only a reason code, so no token, code or secret can reach the logs.
    log: (err) => payload.logger.warn({ reason: err instanceof OAuthError ? err.reason : 'unexpected' }, 'GitHub sign-in failed'),
  })
  if (!result.ok) return fail(result.reason === 'blocked' ? 'failed' : result.reason)

  const res = clearOAuthCookies(NextResponse.redirect(new URL(result.redirectTo, origin), { headers: NO_STORE }))
  res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions())
  return res
}
