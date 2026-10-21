import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { enrichTasks } from '@/enrich/tasks'
import { QUEUES } from '@/sync/queues'
import { isPermanent } from '@/sync/taskKit'
import { jobsConfig, SyncConfigError } from '@/sync/tasks'
import { WORKER_QUEUES } from '@/sync/worker'

describe('enrich task wiring', () => {
  it('registers enrich, enrich-all, enrich-batch and enrich-template after the sync tasks', () => {
    expect(enrichTasks.map((t) => t.slug)).toEqual(['enrich', 'enrich-all', 'enrich-batch', 'enrich-template'])
    expect((jobsConfig.tasks ?? []).map((t) => t.slug)).toEqual([
      'discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate', 'discover-templates', 'sync-template', 'enrich', 'enrich-all', 'enrich-batch', 'enrich-template', 'search-resync', 'render-readmes',
    ])
  })
  it('schedules enrich-all hourly and runs enrich jobs two at a time on their own queue', () => {
    const all = enrichTasks.find((t) => t.slug === 'enrich-all')!
    expect(all.schedule?.map((s) => `${s.cron} @${s.queue}`)).toEqual(['20 * * * * @default'])
    expect(QUEUES.enrich).toBe('enrich')
    expect(WORKER_QUEUES).toContainEqual({ queue: 'enrich', limit: 2 })
  })
  it('collapses duplicate enrich jobs per plugin', () => {
    const enrich = enrichTasks.find((t) => t.slug === 'enrich')!
    const c = enrich.concurrency as unknown as { key: (a: { input: { pluginId: number } }) => string; supersedes: boolean }
    expect(c.key({ input: { pluginId: 7 } })).toBe('enrich:7')
    expect(c.supersedes).toBe(true)
  })
  it('collapses duplicate enrich-template jobs per template and retries like enrich', () => {
    const task = enrichTasks.find((t) => t.slug === 'enrich-template')!
    const c = task.concurrency as unknown as { key: (a: { input: { templateId: number } }) => string; supersedes: boolean }
    expect(c.key({ input: { templateId: 7 } })).toBe('enrich-template:7')
    expect(c.supersedes).toBe(true)
    expect(task.retries).toEqual(enrichTasks.find((t) => t.slug === 'enrich')!.retries)
  })
  it('never retries enrich-all (a retried pass could submit a second batch) and runs one at a time', () => {
    const all = enrichTasks.find((t) => t.slug === 'enrich-all')!
    expect(all.retries).toBe(0)
    expect((all.concurrency as (a: { input: object; queue: string }) => string)({ input: {}, queue: 'default' })).toBe('enrich-all')
  })
  it('keys enrich-batch per batch and gives it 5 retries', () => {
    const batch = enrichTasks.find((t) => t.slug === 'enrich-batch')!
    const c = batch.concurrency as unknown as { key: (a: { input: { batchId: string } }) => string; supersedes: boolean }
    expect(c.key({ input: { batchId: 'msgbatch_1' } })).toBe('enrich-batch:msgbatch_1')
    expect(c.supersedes).toBe(true)
    expect(batch.retries).toMatchObject({ attempts: 5 })
  })
})

describe('isPermanent (moved to taskKit)', () => {
  const apiError = (status: number) => Anthropic.APIError.generate(status, { error: { type: 'x', message: 'x' } }, 'x', new Headers())
  it('treats Anthropic 400/401/403/404 and config errors as permanent, transient ones not', () => {
    for (const status of [400, 401, 403, 404]) expect(isPermanent(apiError(status))).toBe(true)
    for (const status of [429, 500, 529]) expect(isPermanent(apiError(status))).toBe(false)
    expect(isPermanent(new SyncConfigError('x'))).toBe(true)
    expect(isPermanent(new Error('x'))).toBe(false)
  })
})
