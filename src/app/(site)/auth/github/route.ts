import { NextResponse, type NextRequest } from 'next/server'
import {
  beginGitHubLogin,
  getOAuthConfig,
  OAUTH_RETURN_COOKIE,
  OAUTH_STATE_COOKIE,
  oauthCookieOptions,
  type OAuthConfig,
} from '@/lib/auth/oauth'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export function GET(request: NextRequest) {
  let config: OAuthConfig
  try {
    config = getOAuthConfig()
  } catch {
    return new NextResponse('GitHub sign-in is not configured.', { status: 503, headers: NO_STORE })
  }
  const { url, cookieValue, returnTo } = beginGitHubLogin({ config, returnTo: request.nextUrl.searchParams.get('returnTo') })
  const res = NextResponse.redirect(url, { headers: NO_STORE })
  // State and PKCE verifier stay in an HttpOnly cookie; only the S256 challenge goes to GitHub.
  res.cookies.set(OAUTH_STATE_COOKIE, cookieValue, oauthCookieOptions())
  res.cookies.set(OAUTH_RETURN_COOKIE, returnTo, oauthCookieOptions())
  return res
}
