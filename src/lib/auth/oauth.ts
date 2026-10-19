import { timingSafeEqual } from 'node:crypto'
import {
  authorizationURL,
  codeChallengeS256,
  generateCodeVerifier,
  generateState,
} from '@/auth/githubOAuth'
import type { GitHubAuthClient, GitHubUser } from '@/lib/github/client'
import { getServerURL } from '@/lib/serverUrl'
import { signSessionToken } from './session'

type Env = Record<string, string | undefined>

export const OAUTH_STATE_COOKIE = 'pd_oauth_state'
export const OAUTH_RETURN_COOKIE = 'pd_oauth_return'
export const OAUTH_SCOPES = ['read:user']
export const DEFAULT_RETURN_TO = '/me'
const RETURN_TO_MAX_CHARS = 512
const CODE_MAX_CHARS = 512

export type OAuthConfig = { clientId: string; clientSecret: string; redirectUri: string }

/** Client credentials plus the redirect URI, built only from `getServerURL()`. Throws (fail closed) when anything is missing. */
export function getOAuthConfig(env: Env = process.env): OAuthConfig {
  const clientId = env.GITHUB_OAUTH_CLIENT_ID
  const clientSecret = env.GITHUB_OAUTH_CLIENT_SECRET
  const origin = getServerURL(env)
  if (!clientId || !clientSecret || !origin) {
    throw new Error('GitHub sign-in is not configured (GITHUB_OAUTH_CLIENT_ID, GITHUB_OAUTH_CLIENT_SECRET, SERVER_URL).')
  }
  return { clientId, clientSecret, redirectUri: `${origin}/auth/github/callback` }
}

export function oauthCookieOptions(env: Env = process.env) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/auth/github',
    maxAge: 600,
  }
}

/** Same-site relative paths only; anything else falls back to /me. */
export function sanitizeReturnTo(value: string | null | undefined): string {
  if (!value || value.length > RETURN_TO_MAX_CHARS) return DEFAULT_RETURN_TO
  if (!value.startsWith('/') || value.startsWith('//')) return DEFAULT_RETURN_TO
  // Backslashes (browsers treat `/\` like `//`) and every control character, including tab/CR/LF.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return DEFAULT_RETURN_TO
  // Dot-segments (also percent-encoded) would let `/x/../auth/github` slip past the guard below once normalised.
  const path = value.split(/[?#]/, 1)[0]
  if (path.split('/').some((segment) => /^(\.|%2e){1,2}$/i.test(segment))) return DEFAULT_RETURN_TO
  const { pathname } = new URL(path, 'http://site.invalid')
  if (pathname === '/auth' || pathname.startsWith('/auth/')) return DEFAULT_RETURN_TO
  return value
}

/** base64url never contains `.`, so `state.verifier` splits unambiguously. */
export function encodeStateCookie(state: string, verifier: string): string {
  return `${state}.${verifier}`
}

export function parseStateCookie(raw: string | undefined): { state: string; verifier: string } | null {
  if (!raw) return null
  const parts = raw.split('.')
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  return { state: parts[0], verifier: parts[1] }
}

export function beginGitHubLogin({
  config,
  returnTo,
  newState = generateState,
  newVerifier = generateCodeVerifier,
}: {
  config: OAuthConfig
  returnTo: string | null | undefined
  newState?: () => string
  newVerifier?: () => string
}) {
  const state = newState()
  const verifier = newVerifier()
  const url = authorizationURL({
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    state,
    codeChallenge: codeChallengeS256(verifier),
    scopes: OAUTH_SCOPES,
  })
  return { url, cookieValue: encodeStateCookie(state, verifier), returnTo: sanitizeReturnTo(returnTo) }
}

/** Constant-time comparison; false unless both values are present and equal. */
export function statesMatch(received: string | null | undefined, stored: string | null | undefined): boolean {
  if (!received || !stored) return false
  const a = Buffer.from(received)
  const b = Buffer.from(stored)
  return a.length === b.length && timingSafeEqual(a, b)
}

export type LoginFailure =
  | 'state_mismatch'
  | 'denied'
  | 'missing_code'
  | 'exchange_failed'
  | 'profile_failed'
  | 'blocked'
  | 'server_error'

export type LoginFailureStage = 'exchange' | 'user' | 'db'

export async function completeGitHubLogin(input: {
  code: string | null
  state: string | null
  error: string | null
  /** Raw `pd_oauth_state` cookie value (`state.verifier`). */
  storedState: string | undefined
  storedReturnTo: string | undefined
  config: OAuthConfig
  exchange: (args: { code: string; codeVerifier: string }) => Promise<{ accessToken: string }>
  github: Pick<GitHubAuthClient, 'getAuthenticatedUser'>
  upsert: (user: GitHubUser) => Promise<{ id: number; githubId: number; blocked?: boolean | null }>
  secret: Uint8Array
  now?: Date
  /** Called with a stage tag and the error. Callers must log only a reason code, never the error object's contents. */
  log?: (stage: LoginFailureStage, err: unknown) => void | Promise<void>
}): Promise<{ ok: true; token: string; redirectTo: string } | { ok: false; reason: LoginFailure }> {
  const stored = parseStateCookie(input.storedState)
  if (!stored || !statesMatch(input.state, stored.state)) return { ok: false, reason: 'state_mismatch' }
  if (input.error) return { ok: false, reason: 'denied' }
  if (!input.code || input.code.length > CODE_MAX_CHARS) return { ok: false, reason: 'missing_code' }

  let accessToken: string
  try {
    // The GitHub access token lives only in this function: used once for /user, never logged or stored.
    accessToken = (await input.exchange({ code: input.code, codeVerifier: stored.verifier })).accessToken
  } catch (err) {
    await input.log?.('exchange', err)
    return { ok: false, reason: 'exchange_failed' }
  }

  let profile: GitHubUser
  try {
    profile = await input.github.getAuthenticatedUser(accessToken)
  } catch (err) {
    await input.log?.('user', err)
    return { ok: false, reason: 'profile_failed' }
  }

  let maintainer: { id: number; githubId: number; blocked?: boolean | null }
  try {
    maintainer = await input.upsert(profile)
  } catch (err) {
    await input.log?.('db', err)
    return { ok: false, reason: 'server_error' }
  }
  if (maintainer.blocked) return { ok: false, reason: 'blocked' }

  const token = await signSessionToken({ maintainerId: maintainer.id, githubId: maintainer.githubId }, input.secret, input.now)
  return { ok: true, token, redirectTo: sanitizeReturnTo(input.storedReturnTo) }
}
