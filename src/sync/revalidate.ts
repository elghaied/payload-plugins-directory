import { MAX_TAGS } from '@/lib/revalidate'
import type { FetchFn } from './http'

/**
 * POSTs cache tags to the web container's /api/revalidate. Returns how many unique tags were sent.
 * Errors name only the URL and status: never the secret, the request headers or the response body.
 */
export async function postRevalidate(tags: readonly string[], opts: { fetch: FetchFn; url: string; secret: string }): Promise<number> {
  const unique = [...new Set(tags)]
  for (let i = 0; i < unique.length; i += MAX_TAGS) {
    const res = await opts.fetch(opts.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${opts.secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ tags: unique.slice(i, i + MAX_TAGS) }),
    })
    if (!res.ok) throw new Error(`Revalidation failed: HTTP ${res.status} from ${opts.url}`)
  }
  return unique.length
}
