import { JWTAuthentication, type AuthStrategy } from 'payload'
import { getServerURL } from '@/lib/serverUrl'
import { getSessionSecret, readCookie, SESSION_COOKIE, verifySession } from './session'

export const GITHUB_SESSION_STRATEGY = 'github-session'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Defence in depth on top of SameSite=Lax: an unsafe request whose Origin is not this site never
 * authenticates through the maintainer cookie (Payload's own CSRF check only covers its JWT cookie).
 */
export function isCrossOriginWrite(method: string | undefined, origin: string | null, serverURL: string): boolean {
  if (!method || SAFE_METHODS.has(method.toUpperCase()) || !origin || !serverURL) return false
  try {
    return new URL(origin).origin !== new URL(serverURL).origin
  } catch {
    return true
  }
}

/**
 * Payload REST paths a maintainer session may authenticate on. Everything else under /api/ (payload-preferences,
 * graphql, the other collections) is system surface the product does not need; the UI uses server actions. This is an
 * allow-list so a new Payload endpoint is closed to maintainers by default.
 */
export const MAINTAINER_API_ALLOW_LIST = ['/api/plugins', '/api/submissions'] as const

export function maintainerMayUseApiPath(pathname: string): boolean {
  if (!pathname.startsWith('/api/') && pathname !== '/api') return true
  return MAINTAINER_API_ALLOW_LIST.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

function requestPathname(req: { pathname?: string; url?: string } | undefined): string {
  if (req?.pathname) return req.pathname
  try {
    return req?.url ? new URL(req.url).pathname : '/'
  } catch {
    return '/api/invalid' // unparseable: fail closed
  }
}

const toSeconds = (d: Date) => Math.floor(d.getTime() / 1000)

/**
 * Value for `maintainers.sessionsValidAfter` that revokes every session issued up to now. It is the start of
 * the NEXT whole second, so a token minted in the current second (iat has second precision) is also revoked.
 * A sign-in after revocation gets a later iat once that second begins.
 */
export function revokeSessionsNow(now: Date = new Date()): Date {
  return new Date((toSeconds(now) + 1) * 1000)
}

// Only the fields req.user needs, plus the two moderation fields the checks read (stripped below).
const USER_FIELDS = { githubId: true, login: true, name: true, avatarUrl: true, blocked: true, sessionsValidAfter: true, createdAt: true, updatedAt: true } as const

let loggedMissingSecret = false

export const githubSessionStrategy: AuthStrategy = {
  name: GITHUB_SESSION_STRATEGY,
  authenticate: async ({ headers, payload, req }) => {
    const token = readCookie(headers, SESSION_COOKIE)
    if (!token) return { user: null }
    if (!maintainerMayUseApiPath(requestPathname(req))) return { user: null }
    if (isCrossOriginWrite(req?.method, headers.get('origin'), getServerURL())) return { user: null }

    let secret: Uint8Array
    try {
      secret = getSessionSecret()
    } catch (err) {
      if (!loggedMissingSecret) {
        loggedMissingSecret = true
        payload.logger.error({ err }, 'github-session: SESSION_SECRET missing or too short; maintainer sessions disabled')
      }
      return { user: null }
    }

    const session = await verifySession(token, secret)
    if (!session) return { user: null }

    // System lookup: the strategy runs before any user exists on the request. The cookie only supplies
    // the id; the database row is the source of truth for everything else.
    const maintainer = await payload.findByID({
      collection: 'maintainers',
      id: session.maintainerId,
      depth: 0,
      select: USER_FIELDS,
      overrideAccess: true,
      disableErrors: true,
    })
    if (!maintainer || maintainer.githubId !== session.githubId) return { user: null }
    if (maintainer.blocked) return { user: null }
    if (maintainer.sessionsValidAfter && toSeconds(session.issuedAt) < Math.ceil(new Date(maintainer.sessionsValidAfter).getTime() / 1000)) {
      return { user: null }
    }

    // Admin-only moderation fields stay out of the request user.
    const rest = { ...maintainer }
    delete rest.blocked
    delete rest.sessionsValidAfter
    return { user: { ...rest, collection: 'maintainers', _strategy: GITHUB_SESSION_STRATEGY } }
  },
}

/**
 * What the `maintainers` collection registers. Payload runs custom collection strategies BEFORE its built-in JWT one, so
 * with both an admin `payload-token` and a `pd_session` cookie in one browser the maintainer would win in `payload.auth`
 * and the admin panel would see a non-admin. An admin session therefore takes precedence here. The product's own
 * lookups (getCurrentMaintainer, /auth/session) call `githubSessionStrategy` directly and always get the maintainer.
 */
export const githubSessionAuthStrategy: AuthStrategy = {
  name: GITHUB_SESSION_STRATEGY,
  authenticate: async (args) => {
    if (readCookie(args.headers, `${args.payload.config.cookiePrefix}-token`)) {
      try {
        const admin = await JWTAuthentication(args as never)
        if (admin.user) return admin
      } catch {
        // An unusable admin cookie never blocks the maintainer session.
      }
    }
    return githubSessionStrategy.authenticate(args)
  },
}
