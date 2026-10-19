import { NextResponse, type NextRequest } from 'next/server'
import { getPayload, type Payload } from 'payload'
import config from '@payload-config'
import { exchangeCode, OAuthError } from '@/auth/githubOAuth'
import { NO_STORE } from '@/lib/auth/http'
import { upsertMaintainer } from '@/lib/auth/maintainers'
import {
  completeGitHubLogin,
  getOAuthConfig,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  oauthCookieOptions,
  parseStateCookie,
  statesMatch,
  type OAuthConfig,
} from '@/lib/auth/oauth'
import { getSessionSecret, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session'
import { createGitHubAuthClient } from '@/lib/github/client'
import { getServerURL } from '@/lib/serverUrl'

export const dynamic = 'force-dynamic'

function clearOAuthCookies(res: NextResponse) {
  res.cookies.set(OAUTH_STATE_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 })
  res.cookies.set(OAUTH_RETURN_COOKIE, '', { ...oauthCookieOptions(), maxAge: 0 })
  return res
}

/** Only a reason code ever reaches the logs: no token, code, secret or error message. */
function reasonOf(err: unknown): string {
  return err instanceof OAuthError ? err.reason : err instanceof Error ? err.name : 'unknown'
}

export async function GET(request: NextRequest) {
  // Every URL comes from SERVER_URL; the request's own origin (Host header) is never trusted.
  const origin = getServerURL()
  if (!origin) return clearOAuthCookies(new NextResponse('GitHub sign-in is not configured.', { status: 503, headers: NO_STORE }))

  // Blocked accounts, database errors and unexpected exceptions all share one generic reason.
  const fail = (reason: string) =>
    clearOAuthCookies(NextResponse.redirect(new URL(`/auth/error?reason=${encodeURIComponent(reason)}`, origin), { headers: NO_STORE }))
  const generic = 'failed'

  try {
    const params = request.nextUrl.searchParams
    const stateCookie = request.cookies.get(OAUTH_STATE_COOKIE)?.value
    // A forged or stale callback is rejected before Payload is even initialised.
    const stored = parseStateCookie(stateCookie)
    if (!stored || !statesMatch(params.get('state'), stored.state)) return fail('state_mismatch')

    let oauth: OAuthConfig
    let secret: Uint8Array
    try {
      oauth = getOAuthConfig()
      secret = getSessionSecret()
    } catch {
      return fail('not_configured')
    }

    let payloadPromise: Promise<Payload> | undefined
    const payloadOnce = async () => (payloadPromise ??= (async () => getPayload({ config: await config }))())

    const result = await completeGitHubLogin({
      code: params.get('code'),
      state: params.get('state'),
      error: params.get('error'),
      storedState: stateCookie,
      storedReturnTo: request.cookies.get(OAUTH_RETURN_COOKIE)?.value,
      config: oauth,
      exchange: ({ code, codeVerifier }) =>
        exchangeCode({ ...oauth, code, codeVerifier }, globalThis.fetch.bind(globalThis)),
      github: createGitHubAuthClient(),
      upsert: async (user) => upsertMaintainer(await payloadOnce(), user),
      secret,
      log: async (stage, err) => {
        try {
          ;(await payloadOnce()).logger.warn({ stage, reason: reasonOf(err) }, 'GitHub sign-in failed')
        } catch {
          console.error('GitHub sign-in failed', stage, reasonOf(err))
        }
      },
    })
    if (!result.ok) return fail(result.reason === 'blocked' || result.reason === 'server_error' ? generic : result.reason)

    const res = clearOAuthCookies(NextResponse.redirect(new URL(result.redirectTo, origin), { headers: NO_STORE }))
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions())
    return res
  } catch (err) {
    console.error('GitHub sign-in crashed', reasonOf(err))
    return fail(generic)
  }
}
