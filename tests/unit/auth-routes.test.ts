import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'

const getPayload = vi.fn()
vi.mock('payload', () => ({ getPayload: (...a: unknown[]) => getPayload(...a) }))
vi.mock('@payload-config', () => ({ default: Promise.resolve({}) }))

const SITE = 'https://dir.example'
const stub = (env: Record<string, string>) => {
  for (const k of ['SERVER_URL', 'NEXT_PUBLIC_SITE_URL', 'GITHUB_OAUTH_CLIENT_ID', 'GITHUB_OAUTH_CLIENT_SECRET']) vi.stubEnv(k, '')
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
}
const req = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  new NextRequest(url, init)

beforeEach(() => {
  vi.unstubAllEnvs()
  getPayload.mockReset()
  stub({ SERVER_URL: SITE, GITHUB_OAUTH_CLIENT_ID: 'cid', GITHUB_OAUTH_CLIENT_SECRET: 'csec' })
})

describe('POST /auth/logout', () => {
  it('rejects a cross-origin POST before touching anything (F17)', async () => {
    const { POST } = await import('@/app/(site)/auth/logout/route')
    const res = await POST(req(`${SITE}/auth/logout`, { method: 'POST', headers: { origin: 'https://evil.example', cookie: `${SESSION_COOKIE}=x` } }))
    expect(res.status).toBe(403)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(getPayload).not.toHaveBeenCalled()
  })
  it('fails closed without SERVER_URL, never using the request origin', async () => {
    stub({})
    const { POST } = await import('@/app/(site)/auth/logout/route')
    const res = await POST(req('https://attacker.example/auth/logout', { method: 'POST' }))
    expect(res.status).toBe(503)
    expect(res.headers.get('location')).toBeNull()
  })
  it('revokes the current maintainer, clears the cookie and redirects to SERVER_URL', async () => {
    const update = vi.fn(async () => ({}))
    const findByID = vi.fn(async () => ({ id: 9, githubId: 77 }))
    getPayload.mockResolvedValue({ update, findByID })
    const token = await signSessionToken({ maintainerId: 9, githubId: 77 }, getSessionSecret())
    const { POST } = await import('@/app/(site)/auth/logout/route')
    const res = await POST(req('https://attacker.example/auth/logout', { method: 'POST', headers: { origin: SITE, cookie: `${SESSION_COOKIE}=${token}` } }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${SITE}/`)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toMatch(/pd_session=;.*Max-Age=0/i)
    expect(update).toHaveBeenCalledTimes(1)
    const call = (update.mock.calls[0] as unknown as [{ id: number; overrideAccess: boolean; data: { sessionsValidAfter: string } }])[0]
    expect(call).toMatchObject({ id: 9, overrideAccess: true })
    expect(new Date(call.data.sessionsValidAfter).getTime()).toBeGreaterThan(Date.now())
  })
  it('does not revoke when the token githubId does not match the row', async () => {
    const update = vi.fn()
    getPayload.mockResolvedValue({ update, findByID: vi.fn(async () => ({ id: 9, githubId: 1 })) })
    const token = await signSessionToken({ maintainerId: 9, githubId: 77 }, getSessionSecret())
    const { POST } = await import('@/app/(site)/auth/logout/route')
    const res = await POST(req(`${SITE}/auth/logout`, { method: 'POST', headers: { cookie: `${SESSION_COOKIE}=${token}` } }))
    expect(res.status).toBe(303)
    expect(update).not.toHaveBeenCalled()
  })
  it('still clears the cookie when there is no session', async () => {
    const { POST } = await import('@/app/(site)/auth/logout/route')
    const res = await POST(req(`${SITE}/auth/logout`, { method: 'POST' }))
    expect(res.status).toBe(303)
    expect(getPayload).not.toHaveBeenCalled()
  })
})

describe('GET /auth/session', () => {
  it('answers null without touching Payload when there is no cookie', async () => {
    const { GET } = await import('@/app/(site)/auth/session/route')
    const res = await GET(req(`${SITE}/auth/session`))
    expect(await res.json()).toEqual({ maintainer: null })
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(getPayload).not.toHaveBeenCalled()
  })
  it('returns only login and avatarUrl for a valid session', async () => {
    const findByID = vi.fn(async () => ({
      id: 9, githubId: 77, login: 'octo', name: 'Octo', avatarUrl: 'https://avatars.githubusercontent.com/u/77',
      blocked: false, sessionsValidAfter: null, createdAt: 'x', updatedAt: 'y',
    }))
    getPayload.mockResolvedValue({ findByID, logger: { error: vi.fn() } })
    const token = await signSessionToken({ maintainerId: 9, githubId: 77 }, getSessionSecret())
    const { GET } = await import('@/app/(site)/auth/session/route')
    const res = await GET(req(`${SITE}/auth/session`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } }))
    const body = await res.json()
    expect(body).toEqual({ maintainer: { login: 'octo', avatarUrl: 'https://avatars.githubusercontent.com/u/77' } })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('returns null for a garbage cookie', async () => {
    getPayload.mockResolvedValue({ findByID: vi.fn(), logger: { error: vi.fn() } })
    const { GET } = await import('@/app/(site)/auth/session/route')
    const res = await GET(req(`${SITE}/auth/session`, { headers: { cookie: `${SESSION_COOKIE}=nope` } }))
    expect(await res.json()).toEqual({ maintainer: null })
  })
})

describe('GET /auth/github', () => {
  it('redirects to GitHub with PKCE and sets scoped, no-store state cookies', async () => {
    const { GET } = await import('@/app/(site)/auth/github/route')
    const res = GET(req(`${SITE}/auth/github?returnTo=//evil.example`))
    const loc = new URL(res.headers.get('location')!)
    expect(loc.origin).toBe('https://github.com')
    expect(loc.searchParams.get('redirect_uri')).toBe(`${SITE}/auth/github/callback`)
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256')
    expect(res.headers.get('cache-control')).toBe('no-store')
    const cookies = res.headers.getSetCookie()
    const state = cookies.find((c) => c.startsWith('pd_oauth_state='))!
    expect(state).toMatch(/HttpOnly/i)
    expect(state).toMatch(/SameSite=lax/i)
    expect(state).toMatch(/Path=\/auth\/github/)
    expect(state).toMatch(/Max-Age=600/)
    expect(cookies.find((c) => c.startsWith('pd_oauth_return='))).toMatch(/pd_oauth_return=%2Fme/)
  })
  it('fails closed with 503 when unconfigured', async () => {
    stub({})
    const { GET } = await import('@/app/(site)/auth/github/route')
    expect(GET(req('https://attacker.example/auth/github')).status).toBe(503)
  })
})

describe('GET /auth/github/callback', () => {
  it('clears both cookies and redirects to the error page on a state mismatch, off SERVER_URL only', async () => {
    getPayload.mockResolvedValue({ logger: { warn: vi.fn() } })
    const { GET } = await import('@/app/(site)/auth/github/callback/route')
    const res = await GET(req('https://attacker.example/auth/github/callback?code=c&state=bad', { headers: { cookie: 'pd_oauth_state=good.verifier' } }))
    expect(res.headers.get('location')).toBe(`${SITE}/auth/error?reason=state_mismatch`)
    const cookies = res.headers.getSetCookie().join('\n')
    expect(cookies).toMatch(/pd_oauth_state=;.*Max-Age=0/i)
    expect(cookies).toMatch(/pd_oauth_return=;.*Max-Age=0/i)
    expect(cookies).not.toMatch(/pd_session/)
    expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it('fails closed without SERVER_URL and still clears the cookies', async () => {
    stub({ GITHUB_OAUTH_CLIENT_ID: 'cid', GITHUB_OAUTH_CLIENT_SECRET: 'csec' })
    const { GET } = await import('@/app/(site)/auth/github/callback/route')
    const res = await GET(req('https://attacker.example/auth/github/callback?code=c&state=s'))
    expect(res.status).toBe(503)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.getSetCookie().join('\n')).toMatch(/pd_oauth_state=;.*Max-Age=0/i)
  })
})
