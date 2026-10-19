import { revalidateTag } from 'next/cache'
import { isAuthorizedRevalidation, isUsableSecret, MAX_BODY_BYTES, parseRevalidateBody } from '@/lib/revalidate'

export const dynamic = 'force-dynamic'

/**
 * Internal endpoint for the worker's `revalidate` jobs (spec §4.1): the worker is a separate process and cannot
 * call revalidateTag itself. Reachable publicly too, so everything hinges on REVALIDATE_SECRET. Fails closed:
 * an unset or too-short secret disables the endpoint, and the response does not say which.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.REVALIDATE_SECRET
  if (!isUsableSecret(secret)) return Response.json({ error: 'unavailable' }, { status: 503 })
  if (!isAuthorizedRevalidation(request.headers.get('authorization'), secret)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  let body: unknown
  try {
    const text = await request.text()
    if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'body too large' }, { status: 413 })
    body = JSON.parse(text)
  } catch {
    return Response.json({ error: 'body must be JSON' }, { status: 400 })
  }
  const parsed = parseRevalidateBody(body)
  if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 })
  // 'max': stale-while-revalidate — the next visitor gets the old page while the new one renders (Next 16.4).
  for (const tag of parsed.tags) revalidateTag(tag, 'max')
  return Response.json({ revalidated: parsed.tags })
}
