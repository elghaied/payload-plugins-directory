export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }
export const PAYLOAD_MAJORS = ['1', '2', '3', '4'] as const
export type PayloadMajorInput = (typeof PAYLOAD_MAJORS)[number]

export const MCP_QUERY_MAX_CHARS = 500
export const MCP_LIMIT_DEFAULT = 10
export const MCP_LIMIT_MAX = 25
/** Raw entries accepted in `slugs` before de-duplication; the valid result is 2-5. */
const MAX_RAW_SLUGS = 20

const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/
const fail = (error: string) => ({ ok: false as const, error })
const absent = (v: unknown) => v === undefined || v === null || v === ''

type SearchInput = { query: string; payloadMajor?: PayloadMajorInput; category?: string; limit: number }

/** Strict: every field is type- and length-checked. `limit` is clamped, never rejected for being too large. */
export function parseSearchPluginsInput(input: Record<string, unknown>): Parsed<SearchInput> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return fail('Arguments must be an object.')
  if (input.query !== undefined && typeof input.query !== 'string') return fail('query must be a string.')
  const query = (input.query as string | undefined) ?? ''
  if (Array.from(query).length > MCP_QUERY_MAX_CHARS) return fail(`query must be at most ${MCP_QUERY_MAX_CHARS} characters.`)
  const value: SearchInput = { query, limit: MCP_LIMIT_DEFAULT }

  if (!absent(input.payloadMajor)) {
    if (typeof input.payloadMajor !== 'string' && typeof input.payloadMajor !== 'number') return fail('payloadMajor must be one of "1", "2", "3", "4".')
    const major = String(input.payloadMajor)
    if (!(PAYLOAD_MAJORS as readonly string[]).includes(major)) return fail('payloadMajor must be one of "1", "2", "3", "4".')
    value.payloadMajor = major as PayloadMajorInput
  }
  if (!absent(input.category)) {
    const category = typeof input.category === 'string' ? input.category.trim() : ''
    if (!SLUG.test(category)) return fail('category must be a category slug from listCategories.')
    value.category = category
  }
  if (input.limit !== undefined && input.limit !== null) {
    if (typeof input.limit !== 'number' || !Number.isFinite(input.limit)) return fail('limit must be a number.')
    value.limit = Math.min(MCP_LIMIT_MAX, Math.max(1, Math.trunc(input.limit)))
  }
  if (!query.trim() && !value.category && !value.payloadMajor) return fail('Provide a query, or a category / payloadMajor filter.')
  return { ok: true, value }
}

export function parseSlugInput(input: Record<string, unknown>): Parsed<string> {
  const slug = typeof input?.slug === 'string' ? input.slug.trim() : ''
  return SLUG.test(slug) ? { ok: true, value: slug } : fail('slug must be a plugin slug, e.g. from searchPlugins results.')
}

export function parseCompareInput(input: Record<string, unknown>): Parsed<string[]> {
  const raw = input?.slugs
  if (!Array.isArray(raw) || raw.length > MAX_RAW_SLUGS) return fail('slugs must be an array of 2–5 plugin slugs.')
  const slugs = [...new Set(raw.map((s) => (typeof s === 'string' ? s.trim() : '')))]
  if (slugs.length < 2 || slugs.length > 5 || !slugs.every((s) => SLUG.test(s))) return fail('slugs must be 2–5 distinct plugin slugs.')
  return { ok: true, value: slugs }
}
