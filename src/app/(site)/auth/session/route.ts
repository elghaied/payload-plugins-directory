import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { NO_STORE } from '@/lib/auth/http'
import { readCookie, SESSION_COOKIE } from '@/lib/auth/session'
import { GITHUB_SESSION_STRATEGY, githubSessionStrategy } from '@/lib/auth/strategy'

export const dynamic = 'force-dynamic'

/** Who is signed in, for the client-side navbar. Exposes only the login and avatar. Never cacheable. */
export async function GET(request: NextRequest) {
  // No cookie: answer without touching Payload.
  if (!readCookie(request.headers, SESSION_COOKIE)) {
    return NextResponse.json({ maintainer: null }, { headers: NO_STORE })
  }
  const payload = await getPayload({ config: await config })
  const { user } = await githubSessionStrategy.authenticate({
    headers: request.headers,
    payload,
    strategyName: GITHUB_SESSION_STRATEGY,
  })
  const maintainer =
    user?.collection === 'maintainers'
      ? { login: String(user.login ?? ''), avatarUrl: typeof user.avatarUrl === 'string' ? user.avatarUrl : null }
      : null
  return NextResponse.json({ maintainer }, { headers: NO_STORE })
}
