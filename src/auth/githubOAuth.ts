import { createHash, randomBytes } from 'node:crypto'
import type { FetchFn } from '@/sync/http'
import { withTimeout } from '@/sync/http'

const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize'
const TOKEN_URL = 'https://github.com/login/oauth/access_token'
export const OAUTH_TIMEOUT_MS = 10_000

/** A failed GitHub OAuth exchange. Messages never contain the code, secret or token. */
export class OAuthError extends Error {
  constructor(
    message: string,
    readonly reason: 'provider' | 'http' | 'no-token' | 'network',
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

/** 32 random bytes, base64url. */
export function generateState(): string {
  return randomBytes(32).toString('base64url')
}

/** 32 random bytes, base64url (43 characters, within RFC 7636's 43-128). */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url')
}

/** RFC 7636 S256: base64url (no padding) of the SHA-256 of the verifier. */
export function codeChallengeS256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function authorizationURL(params: {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  scopes: string[]
}): URL {
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('scope', params.scopes.join(' '))
  url.searchParams.set('code_challenge', params.codeChallenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('allow_signup', 'true')
  return url
}

/** Exchanges an authorization code for an access token. Throws `OAuthError` on every failure. */
export async function exchangeCode(
  params: { clientId: string; clientSecret: string; redirectUri: string; code: string; codeVerifier: string },
  fetch: FetchFn,
  timeoutMs: number = OAUTH_TIMEOUT_MS,
): Promise<{ accessToken: string }> {
  const body = new URLSearchParams({
    client_id: params.clientId,
    client_secret: params.clientSecret,
    code: params.code,
    redirect_uri: params.redirectUri,
    code_verifier: params.codeVerifier,
  })
  let res: Response
  try {
    res = await withTimeout(fetch, timeoutMs)(TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
    throw new OAuthError(timedOut ? 'GitHub token exchange timed out.' : 'GitHub token exchange failed.', 'network')
  }
  if (!res.ok) throw new OAuthError(`GitHub token exchange failed with HTTP ${res.status}.`, 'http')
  let json: { access_token?: unknown; error?: unknown } | null
  try {
    json = (await res.json()) as typeof json
  } catch {
    throw new OAuthError('GitHub token exchange returned an unreadable response.', 'no-token')
  }
  // GitHub reports a bad or reused code with HTTP 200 and an `error` field.
  if (json && typeof json.error === 'string') throw new OAuthError(`GitHub rejected the sign-in: ${json.error.slice(0, 64)}.`, 'provider')
  if (!json || typeof json.access_token !== 'string' || !json.access_token) {
    throw new OAuthError('GitHub token exchange returned no access token.', 'no-token')
  }
  return { accessToken: json.access_token }
}
