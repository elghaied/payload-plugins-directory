import { describe, expect, it } from 'vitest'
import {
  authorizationURL, codeChallengeS256, exchangeCode, generateCodeVerifier, generateState, OAuthError,
} from '@/auth/githubOAuth'
import type { FetchFn } from '@/sync/http'

const params = { clientId: 'cid', clientSecret: 'sec-ret', redirectUri: 'http://localhost:3000/auth/github/callback', code: 'the-code', codeVerifier: 'ver' }
const json = (body: unknown, status = 200): FetchFn => async () => new Response(JSON.stringify(body), { status })

describe('pkce and state', () => {
  it('matches the RFC 7636 Appendix B vector', () => {
    expect(codeChallengeS256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('generates 43-char base64url values that differ per call', () => {
    for (const f of [generateState, generateCodeVerifier]) {
      expect(f()).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(f()).not.toBe(f())
    }
  })
})

describe('authorizationURL', () => {
  it('has every parameter, encoded', () => {
    const url = authorizationURL({ clientId: 'cid', redirectUri: params.redirectUri, state: 's t', codeChallenge: 'chal', scopes: ['read:user', 'user:email'] })
    expect(url.origin + url.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid', redirect_uri: params.redirectUri, state: 's t', scope: 'read:user user:email',
      code_challenge: 'chal', code_challenge_method: 'S256', allow_signup: 'true',
    })
    expect(url.search).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fauth%2Fgithub%2Fcallback')
    expect(url.search).toContain('scope=read%3Auser+user%3Aemail')
  })
})

describe('exchangeCode', () => {
  it('posts a form with Accept: application/json and returns the token', async () => {
    let seen: { url: string; init?: RequestInit } | undefined
    const fetch: FetchFn = async (url, init) => {
      seen = { url, init }
      return new Response(JSON.stringify({ access_token: 'tok' }))
    }
    expect(await exchangeCode(params, fetch)).toEqual({ accessToken: 'tok' })
    expect(seen?.url).toBe('https://github.com/login/oauth/access_token')
    expect(seen?.init?.method).toBe('POST')
    expect((seen?.init?.headers as Record<string, string>).Accept).toBe('application/json')
    const form = new URLSearchParams(String(seen?.init?.body))
    expect(Object.fromEntries(form)).toEqual({
      client_id: 'cid', client_secret: 'sec-ret', code: 'the-code', redirect_uri: params.redirectUri, code_verifier: 'ver',
    })
  })
  it('throws OAuthError for a 200 response carrying an error, without leaking secrets', async () => {
    const err = await exchangeCode(params, json({ error: 'bad_verification_code', error_description: 'x the-code' })).catch((e) => e)
    expect(err).toBeInstanceOf(OAuthError)
    expect(err.reason).toBe('provider')
    expect(err.message).not.toMatch(/the-code|sec-ret/)
  })
  it('throws OAuthError for a non-2xx response', async () => {
    const err = await exchangeCode(params, json({ access_token: 'tok' }, 500)).catch((e) => e)
    expect(err).toBeInstanceOf(OAuthError)
    expect(err.reason).toBe('http')
  })
  it('throws OAuthError when there is no access_token', async () => {
    for (const body of [{}, { access_token: '' }, { access_token: 5 }]) {
      await expect(exchangeCode(params, json(body))).rejects.toMatchObject({ name: 'OAuthError', reason: 'no-token' })
    }
    await expect(exchangeCode(params, async () => new Response('<html>'))).rejects.toMatchObject({ reason: 'no-token' })
  })
  it('throws OAuthError on timeout', async () => {
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)))
    await expect(exchangeCode(params, hang, 20)).rejects.toMatchObject({ name: 'OAuthError', reason: 'network', message: expect.stringMatching(/timed out/) })
  })
  it('wraps a network failure', async () => {
    await expect(exchangeCode(params, async () => { throw new Error('ECONNRESET sec-ret') })).rejects.toMatchObject({ reason: 'network', message: expect.not.stringMatching(/sec-ret/) })
  })
})
