import type { Payload, TaskConfig } from 'payload'
import { getEnrichClient, getSyncDeps } from '@/sync/deps'
import { QUEUES } from '@/sync/queues'
import { queueRevalidate, track } from '@/sync/taskKit'
import { honourRetryAfter } from '../client'
import { runEnrichTemplate } from './run'

/** One `enrich-template` job per template; the per-template concurrency key (supersedes) collapses duplicates that have not started. */
export async function queueEnrichTemplate(payload: Payload, ids: readonly number[]): Promise<number> {
  const unique = [...new Set(ids)]
  for (const templateId of unique) {
    await payload.jobs.queue({ task: 'enrich-template', input: { templateId }, queue: QUEUES.enrich, overrideAccess: true })
  }
  return unique.length
}

/** Direct template enrichment: the `enrich` task's retries, queue, re-queue on retry-after and paid-answer rules. */
export const enrichTemplateTask: TaskConfig<'enrich-template'> = {
  slug: 'enrich-template',
  label: 'Enrich template (AI)',
  retries: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 } },
  concurrency: { key: ({ input }) => `enrich-template:${input.templateId}`, supersedes: true },
  inputSchema: [{ name: 'templateId', type: 'number', required: true }],
  outputSchema: [
    { name: 'status', type: 'text' },
    { name: 'reason', type: 'text' },
    { name: 'inputTokens', type: 'number' },
    { name: 'outputTokens', type: 'number' },
    { name: 'cacheReadTokens', type: 'number' },
  ],
  handler: async ({ input, req }) => {
    const { payload } = req
    const deps = getSyncDeps()
    const at = deps.now()
    const output = await track(
      payload,
      'enrich-template',
      at,
      async () => {
        const r = await honourRetryAfter(at, () => runEnrichTemplate(payload, input.templateId, getEnrichClient(deps), deps.now))
        // The answer is paid for: a failed revalidate enqueue must not fail the job (a retry would call the API again).
        try {
          await queueRevalidate(payload, r.revalidateTags)
        } catch (err) {
          payload.logger.error({ err, msg: `enrich-template: could not queue revalidation for template ${input.templateId}; pages refresh within the hour` })
        }
        return {
          status: r.status,
          ...(r.reason ? { reason: r.reason } : {}),
          inputTokens: r.usage.input,
          outputTokens: r.usage.output,
          cacheReadTokens: r.usage.cacheRead,
        }
      },
      (err) => payload.jobs.queue({ task: 'enrich-template', input, queue: QUEUES.enrich, waitUntil: err.resetAt, overrideAccess: true }),
    )
    return { output }
  },
}
