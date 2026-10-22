import type { TaskConfig } from 'payload'
import { createSyncContext, getSyncDeps } from '../deps'
import { QUEUES } from '../queues'
import { queueRevalidate, track, withQuota } from '../taskKit'
import { RateLimitError } from '../http'
import { runDiscoverTemplates, runSyncTemplate, type SyncTemplateInput } from './syncTemplate'
import { runTemplateTopicDiscovery } from './topicDiscovery'

const discoverTemplatesTask: TaskConfig<'discover-templates'> = {
  slug: 'discover-templates',
  label: 'Discover templates',
  schedule: [{ cron: '15 */6 * * *', queue: QUEUES.default }],
  retries: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: () => 'discover-templates',
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'queued', type: 'number' },
    { name: 'autoListed', type: 'number' },
    { name: 'suggested', type: 'number' },
    { name: 'found', type: 'number' },
    { name: 'warning', type: 'text' },
  ],
  handler: async ({ req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const ctx = createSyncContext(deps)
    const at = deps.now()
    const output = await withQuota(payload, ctx.github, at, () =>
      track(payload, 'discover-templates', at, async () => {
        // Known templates first (database reads only): each sync-template job reads its repository itself.
        const inputs = await runDiscoverTemplates(payload)
        const seen = new Set(inputs.map((i) => `${i.fullName.toLowerCase()}\n${i.path ?? ''}`))
        // Then GitHub: `payload-template` repositories are listed, broader matches suggested for review.
        let discovery = { autoListed: [] as SyncTemplateInput[], suggested: 0, found: 0 }
        let warning: string | undefined
        try {
          discovery = await runTemplateTopicDiscovery(payload, ctx.github, at)
        } catch (err) {
          // A GitHub problem must not stop the re-sync of known templates; discovery runs again in 6 hours.
          payload.logger.warn({ err }, 'Template discovery failed; known templates are still re-synced')
          warning = err instanceof RateLimitError ? 'GitHub rate limit: template discovery skipped' : `Template discovery failed: ${(err as Error).message}`.slice(0, 300)
        }
        for (const input of discovery.autoListed) {
          if (!seen.has(`${input.fullName.toLowerCase()}\n`)) inputs.push(input)
        }
        for (const input of inputs) {
          await payload.jobs.queue({ task: 'sync-template', input, queue: QUEUES.sync, overrideAccess: true })
        }
        return {
          status: warning ? 'partial' : 'ok',
          queued: inputs.length,
          autoListed: discovery.autoListed.length,
          suggested: discovery.suggested,
          found: discovery.found,
          ...(warning ? { warning } : {}),
        }
      }),
    )
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
    { name: 'source', type: 'select', options: ['official', 'submission', 'converted', 'topic'], required: true },
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
