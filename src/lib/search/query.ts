export const MAX_QUERY_LENGTH = 200
/** Raw input is cut to this many UTF-16 units before any regex or normalisation runs (bounds the work for huge bodies). */
const RAW_INPUT_LIMIT = MAX_QUERY_LENGTH * 4
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
const MAX_PREFIX_TOKENS = 8
/** One-letter prefixes (`a:*`) match nearly every row and make Postgres rank every README vector. */
const MIN_PREFIX_TOKEN_LENGTH = 2
const MAX_TOKEN_LENGTH = 32

export type NormalizedQuery = {
  /** Trimmed, whitespace-collapsed query (≤ MAX_QUERY_LENGTH code points). Sent to websearch_to_tsquery and ILIKE as a bound parameter. */
  text: string
  /** to_tsquery syntax built only from quoted letter/digit tokens of 2+ characters, e.g. "'auth':* & 'next':*"; '' when there are none. */
  prefix: string
  truncated: boolean
}

const take = (s: string, n: number) => Array.from(s).slice(0, n).join('')

export function buildPrefixQuery(text: string): string {
  const tokens = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .map((t) => take(t, MAX_TOKEN_LENGTH))
    .filter((t) => Array.from(t).length >= MIN_PREFIX_TOKEN_LENGTH)
  // Tokens are letters/digits only, and each one is quoted so it can never form an operator.
  return [...new Set(tokens)]
    .slice(0, MAX_PREFIX_TOKENS)
    .map((t) => `'${t}':*`)
    .join(' & ')
}

export function normalizeQuery(raw: unknown): NormalizedQuery | null {
  if (typeof raw !== 'string') return null
  // Control/format characters (incl. NUL, which Postgres rejects in text parameters) become spaces.
  const rawTruncated = raw.length > RAW_INPUT_LIMIT
  // Slice first (a 10 MB body would otherwise cost ~850 ms in the regexes), replace lone surrogates, then NFKC
  // (full-width forms, ligatures, composed accents). NFKC can expand a character, so the code-point cap comes after it.
  const bounded = raw.slice(0, RAW_INPUT_LIMIT).replace(LONE_SURROGATE, ' ').normalize('NFKC')
  const cleaned = bounded.replace(/[\p{Cc}\p{Cf}]/gu, ' ').replace(/\s+/g, ' ').trim()
  if (!cleaned) return null
  const truncated = rawTruncated || Array.from(cleaned).length > MAX_QUERY_LENGTH
  const text = truncated ? take(cleaned, MAX_QUERY_LENGTH).trim() : cleaned
  return { text, prefix: buildPrefixQuery(text), truncated }
}

/** Escapes LIKE/ILIKE wildcards; Postgres' default LIKE escape character is the backslash. */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (c) => `\\${c}`)
}
