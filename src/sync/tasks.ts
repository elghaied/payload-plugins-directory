import type { JobsConfig, Payload, TaskConfig } from 'payload'
import { isAdmin, isAdminUser } from '@/access'
import { queueEnrichForChanged } from '@/enrich/queue'
import { enrichTasks } from '@/enrich/tasks'
import { SNAPSHOT_TAGS } from '@/lib/cacheTags'
import { isUsableSecret, MIN_SECRET_LENGTH } from '@/lib/revalidate'
import { createSyncContext, getSyncDeps } from './deps'
import { runDiscover } from './discover'
import type { GitHubClient } from './github'
import { DISCOVER_GUARD_KEY, recordGitHubQuota, recordJobSuccess } from './jobStatus'
import { runNpmStats } from './npmStats'
import { QUEUES } from './queues'
import { postRevalidate } from './revalidate'
import { sweepOrphanMedia } from '@/lib/maintainers/mediaCleanup'
import { runSnapshot } from './snapshot'
import { runSyncRepository } from './syncRepository'
import { queueRevalidate, SyncConfigError, track } from './taskKit'

export { isPermanent, SyncConfigError } from './taskKit'

/** Records the GitHub quota the run saw, whether it succeeded or not (the widget shows the latest one). */
async function withQuota<T>(payload: Payload, github: GitHubClient, at: Date, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } finally {
    await recordGitHubQuota(payload, github.quota, at).catch((err: unknown) =>
      payload.logger.error({ err, msg: 'Could not record the GitHub quota' }),
    )
  }
}

const discoverTask: TaskConfig<'discover'> = {
  slug: 'discover',
  label: 'Discover repositories',
  schedule: [{ cron: '0 */6 * * *', queue: QUEUES.default }],
  retries: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: () => 'discover',
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'discovered', type: 'number' },
    { name: 'known', type: 'number' },
    { name: 'knownSeen', type: 'number' },
    { name: 'queued', type: 'number' },
    { name: 'trashed', type: 'number' },
    { name: 'warning', type: 'text' },
  ],
  handler: async ({ req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const ctx = createSyncContext(deps)
    const at = deps.now()
    const output = await withQuota(payload, ctx.github, at, () =>
      track(
        payload,
        'discover',
        at,
        async () => {
          const r = await runDiscover(payload, ctx)
          if (r.guardTripped) {
            // Own row and timestamp: a later failed run must not hide the last guard warning from the dashboard.
            // Same `at` as the run's own success row, so "guard current" = guard.lastSuccessAt >= discover.lastSuccessAt.
            await recordJobSuccess(payload, DISCOVER_GUARD_KEY, { warning: r.warning, known: r.known, knownSeen: r.knownSeen }, at)
            if (r.warning) payload.logger.warn(r.warning)
          }
          for (const input of r.toSync) {
            await payload.jobs.queue({ task: 'sync-repository', input, queue: QUEUES.sync, overrideAccess: true })
          }
          await queueRevalidate(payload, r.revalidateTags)
          return {
            status: r.guardTripped ? 'guarded' : 'ok',
            discovered: r.discovered,
            known: r.known,
            knownSeen: r.knownSeen,
            queued: r.toSync.length,
            trashed: r.trashed.length,
            ...(r.warning ? { warning: r.warning } : {}),
          }
        },
        (err) => payload.jobs.queue({ task: 'discover', input: {}, queue: QUEUES.default, waitUntil: err.resetAt, overrideAccess: true }),
      ),
    )
    return { output }
  },
}

const syncRepositoryTask: TaskConfig<'sync-repository'> = {
  slug: 'sync-repository',
  label: 'Sync repository',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
  // One sync per repository at a time; a newer queued sync replaces an older one that has not started. Keyed by the
  // lower-cased full name so every source (topic search, official monorepo, submissions, stale rows) shares one key.
  concurrency: { key: ({ input }) => `sync-repository:${input.fullName.toLowerCase()}`, supersedes: true },
  inputSchema: [
    { name: 'fullName', type: 'text', required: true },
    { name: 'githubId', type: 'number' },
    { name: 'source', type: 'select', options: ['topic', 'official', 'submission'], defaultValue: 'topic' },
    { name: 'discovered', type: 'checkbox', defaultValue: true },
  ],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'contentReRead', type: 'checkbox' },
    { name: 'created', type: 'number' },
    { name: 'updated', type: 'number' },
    { name: 'restored', type: 'number' },
    { name: 'trashed', type: 'number' },
    { name: 'contentChanged', type: 'number', hasMany: true },
    { name: 'enrichQueued', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const ctx = createSyncContext(deps)
    const at = deps.now()
    const output = await withQuota(payload, ctx.github, at, () =>
      track(
        payload,
        'sync-repository',
        at,
        async () => {
          const r = await runSyncRepository(payload, input, ctx)
          await queueRevalidate(payload, r.revalidateTags)
          if (r.created.length) {
            await payload.jobs.queue({ task: 'npm-stats', input: { slugs: r.created }, queue: QUEUES.default, overrideAccess: true })
          }
          // Re-enrich previously enriched plugins whose content changed; never-enriched ones go to enrich-all (batched).
          const enrichQueued = await queueEnrichForChanged(payload, r.contentChanged)
          return {
            status: r.status,
            contentReRead: r.contentReRead,
            created: r.created.length,
            updated: r.updated.length,
            restored: r.restored.length,
            trashed: r.trashed.length,
            contentChanged: r.contentChanged,
            enrichQueued,
          }
        },
        (err) => payload.jobs.queue({ task: 'sync-repository', input, queue: QUEUES.sync, waitUntil: err.resetAt, overrideAccess: true }),
      ),
    )
    return { output }
  },
}

const npmStatsTask: TaskConfig<'npm-stats'> = {
  slug: 'npm-stats',
  label: 'npm stats',
  schedule: [{ cron: '0 1 * * *', queue: QUEUES.default }],
  retries: { attempts: 2, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: () => 'npm-stats',
  inputSchema: [{ name: 'slugs', type: 'text', hasMany: true }],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'checked', type: 'number' },
    { name: 'updated', type: 'number' },
    { name: 'errors', type: 'number' },
    { name: 'failed', type: 'number' },
    { name: 'mismatched', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const ctx = createSyncContext(deps)
    const at = deps.now()
    // npm-stats calls GitHub to resolve renamed / transferred registry repositories: record the quota it saw.
    const output = await withQuota(payload, ctx.github, at, () => track(
      payload,
      'npm-stats',
      at,
      async () => {
        const r = await runNpmStats(payload, input, ctx)
        await queueRevalidate(payload, r.revalidateTags)
        return {
          status: 'ok',
          checked: r.checked,
          updated: r.updated.length,
          errors: r.errors,
          failed: r.failed.length,
          mismatched: r.mismatched.length,
        }
      },
      (err) =>
        payload.jobs.queue({
          task: 'npm-stats',
          input: (err.requeueInput as { slugs: string[] } | undefined) ?? input,
          queue: QUEUES.default,
          waitUntil: err.resetAt,
          overrideAccess: true,
        }),
    ))
    return { output }
  },
}

const snapshotTask: TaskConfig<'snapshot'> = {
  slug: 'snapshot',
  label: 'Daily snapshot',
  schedule: [{ cron: '30 0 * * *', queue: QUEUES.default }],
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: () => 'snapshot',
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'date', type: 'text' },
    { name: 'repositories', type: 'number' },
    { name: 'plugins', type: 'number' },
  ],
  handler: async ({ req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const at = deps.now()
    const output = await track(payload, 'snapshot', at, async () => {
      const r = await runSnapshot(payload, at)
      // Trending and stats pages (Phase 3) read the snapshot tables.
      await queueRevalidate(payload, SNAPSHOT_TAGS)
      // Housekeeping: never fails the snapshot.
      await sweepOrphanMedia(payload, at).catch((err) => payload.logger.error({ err }, 'media sweep failed'))
      return { status: 'ok', ...r }
    })
    return { output }
  },
}

const revalidateTask: TaskConfig<'revalidate'> = {
  slug: 'revalidate',
  label: 'Revalidate pages',
  retries: { attempts: 5, backoff: { type: 'exponential', delay: 10_000 } },
  inputSchema: [{ name: 'tags', type: 'text', hasMany: true, required: true }],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'count', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const deps = getSyncDeps()
    const output = await track(req.payload, 'revalidate', deps.now(), async () => {
      const secret = deps.env.revalidateSecret
      // The endpoint rejects shorter secrets (fails closed), so posting would only fail on every attempt.
      if (!isUsableSecret(secret)) {
        throw new SyncConfigError(`REVALIDATE_SECRET is missing or shorter than ${MIN_SECRET_LENGTH} characters; the worker cannot call /api/revalidate`)
      }
      const count = await postRevalidate(input.tags ?? [], {
        fetch: deps.fetch,
        url: `${deps.env.internalWebUrl}/api/revalidate`,
        secret,
        onInvalid: (tags) => req.payload.logger.warn({ msg: `Revalidate: dropped ${tags.length} invalid cache tag(s)`, tags: tags.map((t) => t.slice(0, 80)) }),
      })
      return { status: 'ok', count }
    })
    return { output }
  },
}

export const syncTasks = [discoverTask, syncRepositoryTask, npmStatsTask, snapshotTask, revalidateTask]

const adminOnlyJobs = ({ req }: { req: { user?: unknown } }) => isAdminUser(req.user)

export const jobsConfig: JobsConfig = {
  // Spec §9.1: jobs are admin-only. System code always passes overrideAccess: true explicitly.
  access: { queue: adminOnlyJobs, run: adminOnlyJobs, cancel: adminOnlyJobs },
  // Read-only job list for admins (v4 hides payload-jobs and denies all CRUD by default).
  jobsCollectionOverrides: ({ defaultJobsCollection }) => ({
    ...defaultJobsCollection,
    access: { ...defaultJobsCollection.access, read: isAdmin },
    admin: { ...defaultJobsCollection.admin, group: 'System', hidden: false },
  }),
  tasks: [...syncTasks, ...enrichTasks],
}
