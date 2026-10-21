import type { Payload } from 'payload'
import { revalidationTagsFor } from '@/lib/cacheTags'
import { queueRevalidate } from '@/sync/taskKit'
import type { ReadmeRendering } from '@/sync/context'

export type RenderReadmesResult = { considered: number; rendered: number; withHtml: number; plainText: number; skipped: number }

/**
 * Backfill / re-render: renders the README HTML of every plugin whose stored render version differs from the current
 * pipeline (or all of them with `all`). Each README goes through the isolated worker renderer. Writes skip the
 * per-document revalidation hook; one batched revalidation is queued at the end.
 */
export async function renderReadmes(payload: Payload, rendering: ReadmeRendering, opts: { all?: boolean } = {}): Promise<RenderReadmesResult> {
  const version = rendering.version()
  const docs = await payload.find({
    collection: 'plugins', overrideAccess: true, trash: true, depth: 1, limit: 0, pagination: false,
    select: { slug: true, readme: true, path: true, repository: true, readmeRenderVersion: true },
  })
  const result: RenderReadmesResult = { considered: docs.docs.length, rendered: 0, withHtml: 0, plainText: 0, skipped: 0 }
  const touched: string[] = []
  for (const doc of docs.docs) {
    if (!opts.all && doc.readmeRenderVersion === version) {
      result.skipped++
      continue
    }
    const repo = typeof doc.repository === 'object' && doc.repository ? doc.repository : null
    const html = doc.readme && repo
      ? await rendering.render(doc.readme, { fullName: repo.fullName, defaultBranch: repo.defaultBranch ?? null, path: doc.path ?? null })
      : null
    await payload.update({
      collection: 'plugins', id: doc.id, overrideAccess: true, trash: true, depth: 0, context: { skipRevalidate: true },
      data: { readmeHtml: html, readmeRenderVersion: version },
    })
    result.rendered++
    if (html) result.withHtml++
    else result.plainText++
    touched.push(doc.slug)
  }
  await queueRevalidate(payload, revalidationTagsFor(touched))
  return result
}
