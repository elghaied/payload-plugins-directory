import { SignJWT, jwtVerify } from 'jose'

type Env = Record<string, string | undefined>

export const SESSION_COOKIE = 'pd_session'
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
const ISSUER = 'payload-directory'
const AUDIENCE = 'maintainer-session'
const MIN_SECRET_LENGTH = 32
const MAX_TOKEN_LENGTH = 2048

export type SessionClaims = { maintainerId: number; githubId: number }
/** Verified claims plus the token's issued-at (second precision), for comparison with `maintainers.sessionsValidAfter`. */
export type VerifiedSession = SessionClaims & { issuedAt: Date }

export function getSessionSecret(env: Env = process.env): Uint8Array {
  const raw = env.SESSION_SECRET ?? ''
  if (raw.length < MIN_SECRET_LENGTH) {
    throw new Error(`SESSION_SECRET must be set to at least ${MIN_SECRET_LENGTH} characters.`)
  }
  return new TextEncoder().encode(raw)
}

export async function signSessionToken(claims: SessionClaims, secret: Uint8Array, now: Date = new Date()): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000)
  return new SignJWT({ gid: claims.githubId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(claims.maintainerId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(iat)
    .setExpirationTime(iat + SESSION_MAX_AGE_SECONDS)
    .sign(secret)
}

/**
 * Verified session of a valid, unexpired token signed with `secret`; `null` for anything else (never throws).
 * Signature comparison is constant-time (jose); the algorithm is pinned to HS256.
 */
export async function verifySession(token: string, secret: Uint8Array, now: Date = new Date()): Promise<VerifiedSession | null> {
  if (!token || token.length > MAX_TOKEN_LENGTH) return null
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      currentDate: now,
      maxTokenAge: SESSION_MAX_AGE_SECONDS,
      requiredClaims: ['sub', 'iat', 'exp', 'gid'],
    })
    const maintainerId = Number(payload.sub)
    const githubId = payload.gid
    if (!/^\d+$/.test(payload.sub ?? '') || !Number.isSafeInteger(maintainerId) || maintainerId <= 0) return null
    if (typeof githubId !== 'number' || !Number.isSafeInteger(githubId) || githubId <= 0) return null
    if (typeof payload.iat !== 'number') return null
    return { maintainerId, githubId, issuedAt: new Date(payload.iat * 1000) }
  } catch {
    return null
  }
}

/** Claims of a valid, unexpired token; `null` for anything else (never throws). */
export async function verifySessionToken(token: string, secret: Uint8Array, now: Date = new Date()): Promise<SessionClaims | null> {
  const session = await verifySession(token, secret, now)
  return session && { maintainerId: session.maintainerId, githubId: session.githubId }
}

export function sessionCookieOptions(env: Env = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  }
}

export function readCookie(headers: Headers, name: string): string | undefined {
  const header = headers.get('cookie')
  if (!header) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      return undefined
    }
  }
  return undefined
}
