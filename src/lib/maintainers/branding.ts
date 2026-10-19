import { clampChars } from '@/sync/limits'

export const CUSTOM_TAGLINE_MAX_CHARS = 120

// Control characters become a space. Written with \u escapes only: literal invisible characters get lost in editors.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g
// Zero-width, soft hyphen and bidi-control characters are removed outright (U+200D, the joiner, is handled separately):
// U+00AD, U+061C, U+200B-U+200C, U+200E-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF.
const INVISIBLE_RE = /[\u00ad\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g
const ZWJ = '\u200d'

/** NFKC, invisible characters removed, whitespace collapsed, trimmed. A ZWJ survives only between two visible characters (emoji sequences). */
function clean(input: string): string {
  const base = input.normalize('NFKC').replace(CONTROL_RE, ' ').replace(INVISIBLE_RE, '')
  const joined = base.replace(/\u200d/g, (_m, offset: number) => {
    const before = base[offset - 1]
    const after = base[offset + 1]
    return before && after && /\S/.test(before) && /\S/.test(after) && before !== ZWJ && after !== ZWJ ? ZWJ : ''
  })
  return joined.replace(/\s+/g, ' ').trim()
}

/**
 * Last-line normaliser, used by the `customTagline` field hook so every write path (server action, REST, GraphQL,
 * admin) is normalised. Empty becomes null; over-long input is clamped to 120 characters as a safety net.
 * User-facing input should go through `validateTagline`, which rejects instead of cutting.
 */
export function normalizeTagline(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const cleaned = clean(input)
  if (!cleaned) return null
  return clampChars(cleaned, CUSTOM_TAGLINE_MAX_CHARS).trim() || null
}

export type TaglineValidation = { ok: true; value: string | null } | { ok: false; message: string }

/** For forms and server actions: normalises, and rejects (with a message) a tagline over 120 characters instead of cutting it. */
export function validateTagline(input: unknown): TaglineValidation {
  if (typeof input !== 'string') return { ok: true, value: null }
  const cleaned = clean(input)
  if (!cleaned) return { ok: true, value: null }
  if (cleaned.length > CUSTOM_TAGLINE_MAX_CHARS) return { ok: false, message: `Keep the tagline to ${CUSTOM_TAGLINE_MAX_CHARS} characters or fewer.` }
  return { ok: true, value: cleaned }
}
