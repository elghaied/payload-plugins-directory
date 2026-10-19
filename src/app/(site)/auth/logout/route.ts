import { NextResponse, type NextRequest } from 'next/server'
import { getPayload } from 'payload'
import config from '@payload-config'
import { revokeMaintainerSessions } from '@/lib/auth/maintainers'
import { getSessionSecret, readCookie, SESSION_COOKIE, sessionCookieOptions, verifySession } from '@/lib/auth/session'
import { isCrossOriginWrite } from '@/lib/auth/strategy'
import { getServerURL } from '@/lib/serverUrl'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** POST only, from the account menu form; 303 so the browser follows with a GET. Signs out everywhere. */
export async function POST(request: NextRequest) {
  const origin = getServerURL()
  if (!origin) return new NextResponse('Sign-out is not configured.', { status: 503, headers: NO_STORE })
  // A cross-site form must not be able to force a sign-out.
  if (isCrossOriginWrite(request.method, request.headers.get('origin'), origin)) {
    return new NextResponse('Forbidden', { status: 403, headers: NO_STORE })
  }

  const token = readCookie(request.headers, SESSION_COOKIE)
  if (token) {
    try {
      const session = await verifySession(token, getSessionSecret())
      if (session) {
        const payload = await getPayload({ config: await config })
        const maintainer = await payload.findByID({
          collection: 'maintainers',
          id: session.maintainerId,
          depth: 0,
          select: { githubId: true },
          overrideAccess: true,
          disableErrors: true,
        })
        if (maintainer && maintainer.githubId === session.githubId) await revokeMaintainerSessions(payload, maintainer.id)
      }
    } catch (err) {
      // The cookie is cleared below regardless; report only that revocation failed.
      console.error('logout: session revocation failed', err instanceof Error ? err.name : 'unknown')
    }
  }

  const res = NextResponse.redirect(new URL('/', origin), { status: 303, headers: NO_STORE })
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return res
}
