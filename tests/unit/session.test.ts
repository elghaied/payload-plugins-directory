import { describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import {
  getSessionSecret,
  readCookie,
  sessionCookieOptions,
  signSessionToken,
  verifySession,
  verifySessionToken,
  SESSION_MAX_AGE_SECONDS,
} from '@/lib/auth/session'

const secret = getSessionSecret({ SESSION_SECRET: 'a'.repeat(40) })
const other = getSessionSecret({ SESSION_SECRET: 'b'.repeat(40) })
const claims = { maintainerId: 7, githubId: 4242 }
const DAY = 24 * 60 * 60 * 1000

describe('session tokens', () => {
  it('round-trips the claims', async () => {
    const token = await signSessionToken(claims, secret)
    expect(await verifySessionToken(token, secret)).toEqual(claims)
  })
  it('rejects a token signed with another secret', async () => {
    const token = await signSessionToken(claims, other)
    expect(await verifySessionToken(token, secret)).toBeNull()
  })
  it('rejects a tampered payload', async () => {
    const [h, , s] = (await signSessionToken(claims, secret)).split('.')
    const forged = Buffer.from(JSON.stringify({ sub: '1', gid: 1, iss: 'payload-directory', aud: 'maintainer-session' })).toString('base64url')
    expect(await verifySessionToken(`${h}.${forged}.${s}`, secret)).toBeNull()
  })
  it('rejects an expired token (31 days old)', async () => {
    const now = new Date('2026-10-19T00:00:00Z')
    const token = await signSessionToken(claims, secret, new Date(now.getTime() - 31 * DAY))
    expect(await verifySessionToken(token, secret, now)).toBeNull()
  })
  it('accepts a 29-day-old token', async () => {
    const now = new Date('2026-10-19T00:00:00Z')
    const token = await signSessionToken(claims, secret, new Date(now.getTime() - 29 * DAY))
    expect(await verifySessionToken(token, secret, now)).toEqual(claims)
  })
  it('rejects alg "none"', async () => {
    const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const now = Math.floor(Date.now() / 1000)
    const token = `${enc({ alg: 'none', typ: 'JWT' })}.${enc({ sub: '7', gid: 4242, iss: 'payload-directory', aud: 'maintainer-session', iat: now, exp: now + 60 })}.`
    expect(await verifySessionToken(token, secret)).toBeNull()
  })
  it('rejects another HMAC algorithm even with the right secret', async () => {
    const token = await new SignJWT({ gid: 4242 })
      .setProtectedHeader({ alg: 'HS512' })
      .setSubject('7').setIssuer('payload-directory').setAudience('maintainer-session')
      .setIssuedAt().setExpirationTime('1h')
      .sign(secret)
    expect(await verifySessionToken(token, secret)).toBeNull()
  })
  it('exposes the issued-at time so a strategy can compare it with sessionsValidAfter', async () => {
    const issued = new Date('2026-10-01T12:00:00.123Z')
    const token = await signSessionToken(claims, secret, issued)
    const session = await verifySession(token, secret, new Date('2026-10-02T00:00:00Z'))
    expect(session).toEqual({ ...claims, issuedAt: new Date('2026-10-01T12:00:00.000Z') })
    expect(await verifySession('garbage', secret)).toBeNull()
  })
  it('rejects the wrong audience', async () => {
    const token = await new SignJWT({ gid: 4242 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('7').setIssuer('payload-directory').setAudience('something-else')
      .setIssuedAt().setExpirationTime('1h')
      .sign(secret)
    expect(await verifySessionToken(token, secret)).toBeNull()
  })
  it('rejects a non-numeric subject', async () => {
    const token = await new SignJWT({ gid: 4242 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('admin').setIssuer('payload-directory').setAudience('maintainer-session')
      .setIssuedAt().setExpirationTime('1h')
      .sign(secret)
    expect(await verifySessionToken(token, secret)).toBeNull()
  })
  it('rejects garbage and oversized input', async () => {
    expect(await verifySessionToken('not.a.jwt', secret)).toBeNull()
    expect(await verifySessionToken('x'.repeat(5000), secret)).toBeNull()
  })
})

describe('getSessionSecret', () => {
  it('refuses a missing or short secret', () => {
    expect(() => getSessionSecret({})).toThrow(/SESSION_SECRET/)
    expect(() => getSessionSecret({ SESSION_SECRET: 'short' })).toThrow(/SESSION_SECRET/)
  })
})

describe('cookie helpers', () => {
  it('is httpOnly, Lax, 30 days, Secure only in production', () => {
    expect(sessionCookieOptions({ NODE_ENV: 'production' })).toEqual({
      httpOnly: true, secure: true, sameSite: 'lax', path: '/', maxAge: SESSION_MAX_AGE_SECONDS,
    })
    expect(sessionCookieOptions({ NODE_ENV: 'development' }).secure).toBe(false)
    expect(SESSION_MAX_AGE_SECONDS).toBe(30 * 24 * 60 * 60)
  })
  it('reads one cookie from a Cookie header', () => {
    const h = new Headers({ cookie: 'a=1; pd_session=abc.def.ghi; b=2' })
    expect(readCookie(h, 'pd_session')).toBe('abc.def.ghi')
    expect(readCookie(h, 'missing')).toBeUndefined()
    expect(readCookie(new Headers(), 'pd_session')).toBeUndefined()
  })
})
