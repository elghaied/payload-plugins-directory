import { createHash, timingSafeEqual } from 'node:crypto'
import { isValidCacheTag } from './cacheTags'

export const MAX_TAGS = 500
/** Secrets shorter than this are treated as "not configured": the endpoint fails closed. */
export const MIN_SECRET_LENGTH = 32
/** Upper bound for the request body (500 tags of at most ~210 characters fit comfortably). */
export const MAX_BODY_BYTES = 128 * 1024

const digest = (s: string) => createHash('sha256').update(s).digest()

export const isUsableSecret = (secret: string | undefined): secret is string =>
  typeof secret === 'string' && secret.length >= MIN_SECRET_LENGTH

/** `Authorization: Bearer <secret>`, compared in constant time (hashing first equalises lengths, so length does not leak). */
export function isAuthorizedRevalidation(header: string | null, secret: string): boolean {
  if (!isUsableSecret(secret) || !header?.startsWith('Bearer ')) return false
  return timingSafeEqual(digest(header.slice('Bearer '.length)), digest(secret))
}

export function parseRevalidateBody(body: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  const tags = typeof body === 'object' && body !== null ? (body as { tags?: unknown }).tags : undefined
  if (!Array.isArray(tags) || tags.length === 0) return { ok: false, error: 'tags must be a non-empty array' }
  if (tags.length > MAX_TAGS) return { ok: false, error: `at most ${MAX_TAGS} tags per request` }
  const bad = tags.find((t) => !isValidCacheTag(t))
  if (bad !== undefined) return { ok: false, error: `invalid tag: ${String(bad).slice(0, 80)}` }
  return { ok: true, tags: [...new Set(tags as string[])] }
}
