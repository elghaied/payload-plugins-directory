export const MAX_QUERY_LENGTH = 200
const MAX_PREFIX_TOKENS = 8
const MAX_TOKEN_LENGTH = 32

export type NormalizedQuery = {
  /** Trimmed, whitespace-collapsed query (≤ MAX_QUERY_LENGTH code points). Sent to websearch_to_tsquery and ILIKE as a bound parameter. */
  text: string
  /** to_tsquery syntax built only from letter/digit tokens, e.g. "auth:* & next:*"; '' when there are none. */
  prefix: string
  truncated: boolean
}

const take = (s: string, n: number) => Array.from(s).slice(0, n).join('')

export function buildPrefixQuery(text: string): string {
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map((t) => take(t, MAX_TOKEN_LENGTH))
  return [...new Set(tokens)]
    .slice(0, MAX_PREFIX_TOKENS)
    .map((t) => `${t}:*`)
    .join(' & ')
}

export function normalizeQuery(raw: unknown): NormalizedQuery | null {
  if (typeof raw !== 'string') return null
  // Control/format characters (incl. NUL, which Postgres rejects in text parameters) become spaces.
  const cleaned = raw.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  const truncated = Array.from(cleaned).length > MAX_QUERY_LENGTH
  const text = truncated ? take(cleaned, MAX_QUERY_LENGTH).trim() : cleaned
  return { text, prefix: buildPrefixQuery(text), truncated }
}

/** Escapes LIKE/ILIKE wildcards; Postgres' default LIKE escape character is the backslash. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}
