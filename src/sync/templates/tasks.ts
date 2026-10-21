import type { TaskConfig } from 'payload'
import { createSyncContext, getSyncDeps } from '../deps'
import { QUEUES } from '../queues'
import { queueRevalidate, track, withQuota } from '../taskKit'
import { runDiscoverTemplates, runSyncTemplate, type SyncTemplateInput } from './syncTemplate'

const discoverTemplatesTask: TaskConfig<'discover-templates'> = {
  slug: 'discover-templates',
  label: 'Discover templates',
  schedule: [{ cron: '15 */6 * * *', queue: QUEUES.default }],
  retries: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: () => 'discover-templates',
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'queued', type: 'number' },
  ],
  handler: async ({ req }) => {
    const { payload } = req
    const at = getSyncDeps().now()
    // Database reads only (no GitHub call): each sync-template job reads its repository itself.
    const output = await track(payload, 'discover-templates', at, async () => {
      const inputs = await runDiscoverTemplates(payload)
      for (const input of inputs) {
        await payload.jobs.queue({ task: 'sync-template', input, queue: QUEUES.sync, overrideAccess: true })
      }
      return { status: 'ok', queued: inputs.length }
    })
    return { output }
  },
}

const syncTemplateTask: TaskConfig<'sync-template'> = {
  slug: 'sync-template',
  label: 'Sync template',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  // One sync per template source at a time; a newer queued sync replaces an older one that has not started.
  concurrency: {
    key: ({ input }) => `sync-template:${input.fullName.toLowerCase()}:${input.path ?? ''}`,
    supersedes: true,
  },
  inputSchema: [
    { name: 'fullName', type: 'text', required: true },
    { name: 'githubId', type: 'number' },
    { name: 'path', type: 'text' },
    { name: 'source', type: 'select', options: ['official', 'submission', 'converted'], required: true },
  ],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'created', type: 'number' },
    { name: 'updated', type: 'number' },
    { name: 'trashed', type: 'number' },
    { name: 'contentChanged', type: 'number', hasMany: true },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const ctx = createSyncContext(deps)
    const at = deps.now()
    const output = await withQuota(payload, ctx.github, at, () =>
      track(
        payload,
        'sync-template',
        at,
        async () => {
          const r = await runSyncTemplate(payload, input as SyncTemplateInput, ctx)
          await queueRevalidate(payload, r.revalidateTags)
          return { status: r.status, created: r.created.length, updated: r.updated.length, trashed: r.trashed.length, contentChanged: r.contentChanged }
        },
        (err) => payload.jobs.queue({ task: 'sync-template', input, queue: QUEUES.sync, waitUntil: err.resetAt, overrideAccess: true }),
      ),
    )
    return { output }
  },
}

export const templateSyncTasks = [discoverTemplatesTask, syncTemplateTask]
