import { describe, expect, it, vi } from 'vitest'
import {
  beginGitHubLogin,
  completeGitHubLogin,
  encodeStateCookie,
  getOAuthConfig,
  oauthCookieOptions,
  parseStateCookie,
  sanitizeReturnTo,
  statesMatch,
} from '@/lib/auth/oauth'
import { codeChallengeS256 } from '@/auth/githubOAuth'
import { getSessionSecret, verifySessionToken } from '@/lib/auth/session'

const secret = getSessionSecret({ SESSION_SECRET: 's'.repeat(40) })
const env = { GITHUB_OAUTH_CLIENT_ID: 'cid', GITHUB_OAUTH_CLIENT_SECRET: 'csecret', SERVER_URL: 'https://dir.example/' }
const config = getOAuthConfig(env)
const cookie = encodeStateCookie('state-abc', 'verifier-xyz')

const github = { getAuthenticatedUser: vi.fn(async () => ({ id: 4242, login: 'octo', name: null, avatarUrl: null })) }

function input(over: Partial<Parameters<typeof completeGitHubLogin>[0]> = {}) {
  return {
    code: 'code-1',
    state: 'state-abc',
    error: null,
    storedState: cookie,
    storedReturnTo: '/submit',
    config,
    exchange: vi.fn(async () => ({ accessToken: 'gho_token' })),
    github,
    upsert: vi.fn(async () => ({ id: 7, githubId: 4242, blocked: false })),
    secret,
    ...over,
  }
}

describe('getOAuthConfig', () => {
  it('builds the redirect URI only from SERVER_URL', () => {
    expect(config).toEqual({ clientId: 'cid', clientSecret: 'csecret', redirectUri: 'https://dir.example/auth/github/callback' })
  })
  it.each([
    ['no server url', { ...env, SERVER_URL: '' }],
    ['no client id', { ...env, GITHUB_OAUTH_CLIENT_ID: '' }],
    ['no client secret', { ...env, GITHUB_OAUTH_CLIENT_SECRET: undefined }],
  ])('fails closed with %s', (_l, e) => {
    expect(() => getOAuthConfig(e)).toThrow(/not configured/)
  })
})

describe('sanitizeReturnTo', () => {
  it.each([
    ['/submit', '/submit'],
    ['/plugins/x?tab=1', '/plugins/x?tab=1'],
    [null, '/me'],
    [undefined, '/me'],
    ['', '/me'],
    ['me', '/me'],
    ['https://evil.example', '/me'],
    ['http://evil.example/x', '/me'],
    ['//evil.example', '/me'],
    ['///evil.example', '/me'],
    ['/\\evil.example', '/me'],
    ['\\\\evil.example', '/me'],
    ['/a\\b', '/me'],
    ['javascript:alert(1)', '/me'],
    ['/javascript:alert(1)//', '/javascript:alert(1)//'],
    ['data:text/html,x', '/me'],
    [' /me', '/me'],
    ['\t//evil.example', '/me'],
    ['/\t/evil.example', '/me'],
    ['/\n/evil.example', '/me'],
    ['/auth/github', '/me'],
    ['/auth/logout', '/me'],
    ['/me\r\nSet-Cookie: x', '/me'],
    ['/me\u0000', '/me'],
    ['/me\u007f', '/me'],
    [`/${'a'.repeat(600)}`, '/me'],
  ])('%j → %s', (value, expected) => {
    expect(sanitizeReturnTo(value)).toBe(expected)
  })
  it('stays on this site for every hostile input', () => {
    for (const v of ['//x.y', '/\\x.y', 'https://x.y', '/\t/x.y', '///x.y']) {
      expect(new URL(sanitizeReturnTo(v), 'https://dir.example').origin).toBe('https://dir.example')
    }
  })
})

describe('state cookie', () => {
  it('round-trips state and PKCE verifier', () => {
    expect(parseStateCookie(cookie)).toEqual({ state: 'state-abc', verifier: 'verifier-xyz' })
  })
  it.each([[undefined], [''], ['onlystate'], ['a.b.c'], ['.v'], ['s.']])('rejects %j', (v) => {
    expect(parseStateCookie(v)).toBeNull()
  })
})

describe('beginGitHubLogin', () => {
  it('asks only for read:user, sends an S256 challenge and never the verifier', () => {
    const { url, cookieValue, returnTo } = beginGitHubLogin({
      config, returnTo: '//evil', newState: () => 'st-1', newVerifier: () => 'ver-1',
    })
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(url.searchParams.get('state')).toBe('st-1')
    expect(url.searchParams.get('scope')).toBe('read:user')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('redirect_uri')).toBe('https://dir.example/auth/github/callback')
    expect(url.searchParams.get('code_challenge')).toBe(codeChallengeS256('ver-1'))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.toString()).not.toContain('ver-1')
    expect(cookieValue).toBe(encodeStateCookie('st-1', 'ver-1'))
    expect(returnTo).toBe('/me')
  })
  it('scopes the state cookies to /auth/github for 10 minutes', () => {
    expect(oauthCookieOptions({ NODE_ENV: 'production' })).toEqual({
      httpOnly: true, secure: true, sameSite: 'lax', path: '/auth/github', maxAge: 600,
    })
    expect(oauthCookieOptions({ NODE_ENV: 'development' }).secure).toBe(false)
  })
})

describe('statesMatch', () => {
  it('needs both values and an exact match', () => {
    expect(statesMatch('abc', 'abc')).toBe(true)
    expect(statesMatch('abc', 'abd')).toBe(false)
    expect(statesMatch('abc', 'abcd')).toBe(false)
    expect(statesMatch(null, 'abc')).toBe(false)
    expect(statesMatch('abc', undefined)).toBe(false)
    expect(statesMatch('', '')).toBe(false)
  })
})

describe('completeGitHubLogin', () => {
  it('signs a session for the upserted maintainer and returns to the stored path', async () => {
    const args = input()
    const result = await completeGitHubLogin(args)
    expect(result).toMatchObject({ ok: true, redirectTo: '/submit' })
    if (!result.ok) throw new Error('unreachable')
    expect(await verifySessionToken(result.token, secret)).toEqual({ maintainerId: 7, githubId: 4242 })
    expect(args.upsert).toHaveBeenCalledWith({ id: 4242, login: 'octo', name: null, avatarUrl: null })
  })
  it('sends the stored PKCE verifier with the code, and gives the token only to GitHub /user', async () => {
    const args = input()
    const result = await completeGitHubLogin(args)
    expect(args.exchange).toHaveBeenCalledWith({ code: 'code-1', codeVerifier: 'verifier-xyz' })
    expect(github.getAuthenticatedUser).toHaveBeenCalledWith('gho_token')
    expect(JSON.stringify(result)).not.toContain('gho_token')
  })
  it.each([
    ['state differs', { state: 'other' }],
    ['state param missing', { state: null }],
    ['state cookie missing/expired', { storedState: undefined }],
    ['state cookie malformed', { storedState: 'no-verifier' }],
  ])('refuses when %s, without touching GitHub or the database', async (_label, over) => {
    const args = input(over)
    expect(await completeGitHubLogin(args)).toEqual({ ok: false, reason: 'state_mismatch' })
    expect(args.exchange).not.toHaveBeenCalled()
    expect(args.upsert).not.toHaveBeenCalled()
  })
  it('reports a denied consent screen', async () => {
    expect(await completeGitHubLogin(input({ error: 'access_denied', code: null }))).toEqual({ ok: false, reason: 'denied' })
  })
  it('reports a missing or oversized code', async () => {
    expect(await completeGitHubLogin(input({ code: null }))).toEqual({ ok: false, reason: 'missing_code' })
    expect(await completeGitHubLogin(input({ code: 'x'.repeat(2000) }))).toEqual({ ok: false, reason: 'missing_code' })
  })
  it('reports a failed code exchange', async () => {
    const exchange = vi.fn(async () => { throw new Error('bad_verification_code') })
    expect(await completeGitHubLogin(input({ exchange }))).toEqual({ ok: false, reason: 'exchange_failed' })
  })
  it('reports a failed profile fetch', async () => {
    const failing = { getAuthenticatedUser: vi.fn(async () => { throw new Error('401') }) }
    const args = input({ github: failing })
    expect(await completeGitHubLogin(args)).toEqual({ ok: false, reason: 'profile_failed' })
    expect(args.upsert).not.toHaveBeenCalled()
  })
  it('refuses a blocked maintainer: no token', async () => {
    const result = await completeGitHubLogin(input({ upsert: vi.fn(async () => ({ id: 7, githubId: 4242, blocked: true })) }))
    expect(result).toEqual({ ok: false, reason: 'blocked' })
  })
  it('reports a failed database write', async () => {
    const upsert = vi.fn(async () => { throw new Error('db down') })
    expect(await completeGitHubLogin(input({ upsert }))).toEqual({ ok: false, reason: 'server_error' })
  })
  it('never redirects off-site even if the return cookie was tampered with', async () => {
    const result = await completeGitHubLogin(input({ storedReturnTo: 'https://evil.example/' }))
    expect(result).toMatchObject({ ok: true, redirectTo: '/me' })
  })
})
