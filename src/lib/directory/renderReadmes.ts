import type { Payload, Where } from 'payload'
import { revalidationTagsFor } from '@/lib/cacheTags'
import type { ReadmeRendering } from '@/sync/context'
import { queueRevalidate } from '@/sync/taskKit'
import { readmeStamp } from './readmeStamp'

/** Plugins rendered per job (each render costs about 0.25 s: worker start-up dominates). */
export const RENDER_BATCH = 20
const SCAN_PAGE = 100

export type RenderReadmesResult = {
  considered: number
  rendered: number
  withHtml: number
  plainText: number
  skipped: number
  /** README changed between reading and writing: nothing stored, the next run picks it up. */
  raced: number
  /** Why plain-text renders are plain text (cap:nesting, timeout, ...), counted. */
  reasons: Record<string, number>
}
export type RenderBatchResult = RenderReadmesResult & { lastId: number | null; more: boolean }

const empty = (): RenderReadmesResult => ({ considered: 0, rendered: 0, withHtml: 0, plainText: 0, skipped: 0, raced: 0, reasons: {} })

/**
 * One batch of the README render backfill: scans plugins with a README after `afterId` (id order) and renders up to
 * `limit` whose stored stamp (pipeline version + README hash) is out of date, or every one with `all`. Each README goes
 * through the isolated worker renderer. A result is stored only if the plugin's README still is the text that was
 * rendered (conditional update), so a concurrent sync or edit is never overwritten with HTML of older text. Writes skip
 * the per-document revalidation hook; one batched revalidation is queued at the end. `more` = continue after `lastId`.
 */
export async function renderReadmeBatch(
  payload: Payload,
  rendering: ReadmeRendering,
  opts: { afterId?: number | null; all?: boolean; limit?: number } = {},
): Promise<RenderBatchResult> {
  const version = rendering.version()
  const limit = opts.limit ?? RENDER_BATCH
  const result = empty()
  const touched: string[] = []
  let lastId = opts.afterId ?? null
  let exhausted = false

  while (result.rendered + result.raced < limit && !exhausted) {
    const where: Where = { and: [{ readme: { exists: true } }, ...(lastId != null ? [{ id: { greater_than: lastId } }] : [])] }
    const page = await payload.find({
      collection: 'plugins', overrideAccess: true, trash: true, depth: 1, limit: SCAN_PAGE, pagination: false, sort: 'id', where,
      select: { slug: true, readme: true, path: true, repository: true, readmeRenderVersion: true },
    })
    if (page.docs.length < SCAN_PAGE) exhausted = true
    for (const doc of page.docs) {
      if (result.rendered + result.raced >= limit) {
        exhausted = false
        break
      }
      lastId = doc.id
      result.considered++
      const source = doc.readme ?? ''
      if (!source || (!opts.all && doc.readmeRenderVersion === readmeStamp(version, source))) {
        result.skipped++
        continue
      }
      const repo = typeof doc.repository === 'object' && doc.repository ? doc.repository : null
      const rendered = repo
        ? await rendering.render(source, { fullName: repo.fullName, defaultBranch: repo.defaultBranch ?? null, path: doc.path ?? null })
        : { html: null, reason: 'no-repository' }
      const written = await payload.update({
        collection: 'plugins', overrideAccess: true, trash: true, depth: 0, context: { skipRevalidate: true },
        where: { and: [{ id: { equals: doc.id } }, { readme: { equals: source } }] },
        data: { readmeHtml: rendered.html, readmeRenderVersion: readmeStamp(version, source) },
      })
      if (written.docs.length === 0) {
        result.raced++
        continue
      }
      result.rendered++
      if (rendered.html) result.withHtml++
      else {
        result.plainText++
        const reason = rendered.reason ?? 'unknown'
        result.reasons[reason] = (result.reasons[reason] ?? 0) + 1
        payload.logger.info({ slug: doc.slug, reason }, 'README rendered as plain text')
      }
      touched.push(doc.slug)
    }
  }
  await queueRevalidate(payload, revalidationTagsFor(touched))
  return { ...result, lastId, more: !exhausted }
}

/** All batches in this process (the `payload render-readmes` CLI). */
export async function renderReadmes(payload: Payload, rendering: ReadmeRendering, opts: { all?: boolean } = {}): Promise<RenderReadmesResult> {
  const total = empty()
  let afterId: number | null = null
  for (;;) {
    const b: RenderBatchResult = await renderReadmeBatch(payload, rendering, { afterId, all: opts.all })
    for (const k of ['considered', 'rendered', 'withHtml', 'plainText', 'skipped', 'raced'] as const) total[k] += b[k]
    for (const [r, n] of Object.entries(b.reasons)) total.reasons[r] = (total.reasons[r] ?? 0) + n
    if (!b.more) return total
    afterId = b.lastId
  }
}
