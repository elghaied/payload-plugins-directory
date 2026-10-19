import { isValidCacheTag } from '@/lib/cacheTags'
import { MAX_TAGS } from '@/lib/revalidate'
import type { FetchFn } from './http'

/**
 * POSTs cache tags to the web container's /api/revalidate. Returns how many unique tags were sent.
 * Tags the endpoint would reject are dropped (and passed to `onInvalid`) so one bad tag cannot fail the batch.
 * Errors name only the URL and status: never the secret, the request headers or the response body.
 */
export async function postRevalidate(
  tags: readonly string[],
  opts: { fetch: FetchFn; url: string; secret: string; onInvalid?: (tags: string[]) => void },
): Promise<number> {
  const all = [...new Set(tags)]
  const unique = all.filter(isValidCacheTag)
  if (unique.length < all.length) opts.onInvalid?.(all.filter((t) => !isValidCacheTag(t)))
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
