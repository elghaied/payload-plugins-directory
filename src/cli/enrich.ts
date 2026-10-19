import type { Payload } from 'payload'
import { strictObject, z } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { previewEnrichment } from '@/enrich/preview'
import { queueEnrich } from '@/enrich/queue'
import { QUEUES } from '@/sync/queues'

/** A positive integer, default 5, at most 50. */
export const clampLimit = (raw: string): number => {
  const n = Math.floor(Number(raw))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 50) : 5
}

export type EnrichArgs = { mode: string; slugs: string; limit: string }

/** The command body, separate from Payload's CLI wiring so tests can call it. It never reads the API key. */
export async function runEnrichCommand(payload: Payload, args: EnrichArgs): Promise<void> {
  const slugs = args.slugs.split(',').map((s) => s.trim()).filter(Boolean)

  if (args.mode === 'all') {
    const pending = await payload.count({
      collection: 'payload-jobs',
      overrideAccess: true,
      where: { and: [{ taskSlug: { equals: 'enrich-all' } }, { completedAt: { exists: false } }, { hasError: { not_equals: true } }] },
    })
    if (pending.totalDocs > 0) {
      payload.logger.info('An enrich-all job is already pending; not queueing another.')
      return
    }
    await payload.jobs.queue({ task: 'enrich-all', input: { force: true }, queue: QUEUES.default, overrideAccess: true })
    payload.logger.info('Queued enrich-all (force: ignores the edit debounce); the worker runs it on its next tick.')
    return
  }
  if (args.mode === 'queue') {
    if (!slugs.length) throw new Error('--mode queue needs --slugs a,b,c')
    const found = await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, limit: 0, pagination: false, where: { slug: { in: slugs } } })
    const queued = await queueEnrich(payload, found.docs.map((d) => d.id))
    payload.logger.info({ queued, missing: slugs.filter((s) => !found.docs.some((d) => d.slug === s)) }, 'Queued enrich jobs; the worker runs them')
    return
  }
  if (args.mode !== 'preview') throw new Error(`Unknown --mode "${args.mode}" (preview | queue | all)`)

  const items = await previewEnrichment(payload, { slugs, limit: clampLimit(args.limit) })
  for (const item of items) payload.logger.info(item, `Preview: ${item.slug}`)
  const total = items.reduce((n, i) => n + i.estCostUsd, 0)
  if (items.some((i) => !i.priceKnown)) payload.logger.warn('No price table entry for the configured model: costs use Sonnet 5.5 prices and are a guess.')
  payload.logger.info(
    { requests: items.length, estTotalUsd: Number(total.toFixed(4)) },
    'Preview finished: no API call was made and nothing was written. Estimates only: about 4 characters per token; adaptive-thinking tokens bill as output and add to the cost.',
  )
}

/**
 * `payload enrich --mode preview [--limit 5] [--slugs a,b]`  sizes and estimated cost of the requests; no API call, no write
 * `payload enrich --mode queue --slugs a,b`                    queue enrich jobs (the worker runs them)
 * `payload enrich --mode all`                                  queue enrich-all now, ignoring the edit debounce
 */
export const enrichCommand = defineCLICommand({
  description: 'Preview AI enrichment requests without calling the API or writing, or queue enrich / enrich-all jobs.',
  input: strictObject({
    mode: z._default(z.string(), 'preview'),
    slugs: z._default(z.string(), ''),
    limit: z._default(z.string(), '5'),
  }),
  handler: async ({ args, getPayload }) => runEnrichCommand(await getPayload(), args),
})
