import type { TaskConfig } from 'payload'
import { renderReadmeBatch } from '@/lib/directory/renderReadmes'
import { getSyncDeps, defaultReadmeRendering } from './deps'
import { QUEUES } from './queues'

export type RenderReadmesInput = { afterId?: number | null; all?: boolean }

/**
 * Renders README Markdown to sanitized HTML (isolated worker threads) for plugins whose stored stamp is out of date.
 * Cheap when everything is current. One batch per run; it queues its own continuation, like search-resync. Queued when
 * the worker starts (retried each tick until it is accepted, so it survives running before the migration), on a daily
 * schedule, and after an admin edits a README. `concurrency` keeps it to one run at a time.
 */
export const renderReadmesTask: TaskConfig<'render-readmes'> = {
  slug: 'render-readmes',
  label: 'Render README HTML',
  schedule: [{ cron: '15 2 * * *', queue: QUEUES.default }],
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 30_000 } },
  concurrency: () => 'render-readmes',
  inputSchema: [
    { name: 'afterId', type: 'number' },
    { name: 'all', type: 'checkbox' },
  ],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'considered', type: 'number' },
    { name: 'rendered', type: 'number' },
    { name: 'plainText', type: 'number' },
    { name: 'skipped', type: 'number' },
    { name: 'raced', type: 'number' },
    { name: 'continued', type: 'checkbox' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const rendering = getSyncDeps().readme ?? defaultReadmeRendering()
    if (!rendering) {
      // Web (or any non-worker process): it cannot render (no sources on disk, no isolation). Not an error: skip.
      payload.logger.warn('render-readmes ran outside the worker; skipped')
      return { output: { status: 'skipped', considered: 0, rendered: 0, plainText: 0, skipped: 0, raced: 0, continued: false } }
    }
    const { afterId = null, all = false } = (input ?? {}) as RenderReadmesInput
    const r = await renderReadmeBatch(payload, rendering, { afterId, all })
    if (r.more) {
      await payload.jobs.queue({ task: 'render-readmes', input: { afterId: r.lastId, all }, queue: QUEUES.default, overrideAccess: true })
    }
    if (r.rendered > 0 || r.raced > 0) payload.logger.info({ ...r }, 'README render batch')
    return { output: { status: 'ok', considered: r.considered, rendered: r.rendered, plainText: r.plainText, skipped: r.skipped, raced: r.raced, continued: r.more } }
  },
}
