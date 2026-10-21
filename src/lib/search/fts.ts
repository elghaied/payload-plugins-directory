import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { escapeLike, type NormalizedQuery } from './query'
import type { SearchKind } from './searchDoc'

export type IndexHit = { kind: SearchKind; slug: string; rank: number }

/** Upper bound for one index query; a pathological query is cancelled by Postgres instead of holding a connection. */
export const SEARCH_STATEMENT_TIMEOUT_MS = 2_000
export const SEARCH_MAX_PER_KIND = 500

export class SearchTimeoutError extends Error {
  constructor() {
    super('Search timed out')
    this.name = 'SearchTimeoutError'
  }
}

const isStatementTimeout = (err: unknown): boolean => {
  for (let e: unknown = err; e && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '57014') return true
  }
  return false
}

/**
 * Ranked lookup over the `search` table. Matches stemmed words (websearch syntax: quotes, -exclusions),
 * prefixes (`'token':*`) and title/slug substrings. All user input is a bound parameter; nothing is interpolated.
 * Runs in a transaction with a local statement timeout.
 * Returns candidate slugs only: callers MUST load documents through access-controlled reads.
 */
export async function searchIndex(payload: Payload, query: NormalizedQuery, opts: { perKind: number }): Promise<IndexHit[]> {
  const like = `%${escapeLike(query.text)}%`
  const perKind = Math.max(1, Math.min(SEARCH_MAX_PER_KIND, Math.trunc(opts.perKind)))
  try {
    const result = await payload.db.drizzle.transaction(async (tx) => {
      // SET cannot take bound parameters; set_config can (is_local = true scopes it to this transaction).
      await tx.execute(sql`select set_config('statement_timeout', ${String(SEARCH_STATEMENT_TIMEOUT_MS)}::text, true)`)
      return tx.execute(sql`
        with q as (
          select websearch_to_tsquery('english', ${query.text}::text) as web,
                 case when ${query.prefix}::text = '' then null else to_tsquery('english', ${query.prefix}::text) end as pre
        ),
        hits as (
          select s.kind::text as kind, s.slug, s.title,
                 greatest(coalesce(ts_rank_cd(s.fts, q.web, 32), 0), coalesce(ts_rank_cd(s.fts, q.pre, 32), 0))
                   -- ts_rank_cd is < 1 per vector but README repeats can outscore one title hit, so lexical bonuses
                   -- dominate: exact title or slug (10), slug substring (2), stemmed title word (1.5), title substring (1).
                   + case when lower(s.title) = lower(${query.text}::text)
                            or lower(s.slug) = lower(${query.text}::text)
                            or lower(s.slug) = lower(replace(${query.text}::text, ' ', '-')) then 10 else 0 end
                   + case when s.slug ilike ${like}::text then 2 else 0 end
                   + case when s.title ilike ${like}::text then 1 else 0 end
                   + case when to_tsvector('english', s.title) @@ q.web
                            or (q.pre is not null and to_tsvector('english', s.title) @@ q.pre) then 1.5 else 0 end as rank
          from "search" s cross join q
          where s.fts @@ q.web
             or (q.pre is not null and s.fts @@ q.pre)
             or s.title ilike ${like}::text
             or s.slug ilike ${like}::text
        )
        select kind, slug, rank
        from (select hits.*, row_number() over (partition by kind order by rank desc, title asc, slug asc) as rn from hits) ranked
        where rn <= ${perKind}::int
        order by kind, rank desc, title asc, slug asc
      `)
    })
    return (result.rows as { kind: SearchKind; slug: string; rank: number | string }[]).map((r) => ({
      kind: r.kind,
      slug: r.slug,
      rank: Number(r.rank),
    }))
  } catch (err) {
    if (isStatementTimeout(err)) throw new SearchTimeoutError()
    throw err
  }
}
