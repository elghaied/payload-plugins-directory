import { clampChars } from '@/sync/limits'

export const CUSTOM_TAGLINE_MAX_CHARS = 120

// Control characters, zero-width and bidi-control characters (written as escapes on purpose).
const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g

/**
 * Canonical form of a maintainer-supplied tagline: NFKC, no control/invisible/bidi characters, whitespace
 * collapsed, trimmed, at most 120 characters. Empty becomes null. Used by the `customTagline` field hook, so
 * every write path (server action, REST, GraphQL, admin) is normalised.
 */
export function normalizeTagline(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const cleaned = input.normalize('NFKC').replace(INVISIBLE_RE, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  return clampChars(cleaned, CUSTOM_TAGLINE_MAX_CHARS).trim() || null
}
