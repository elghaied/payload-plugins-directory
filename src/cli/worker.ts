import { strictObject } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { QUEUES } from '@/sync/queues'
import { queueFirstTemplateDiscovery } from '@/sync/templates/bootstrap'
import { runWorkerTick } from '@/sync/worker'

/** Longest a SIGTERM waits for the running batch; keep below the compose `stop_grace_period`. */
const SHUTDOWN_GRACE_MS = 45_000

let stopping = false
let current: Promise<unknown> | null = null
let handlersInstalled = false
let readmeRenderQueued = false
let templateBootstrapDone = false

/**
 * Payload's `--cron` runner (croner) has no stop hook and installs no signal handlers, so a bare SIGTERM
 * would kill a batch mid-job and leave jobs `processing`. On SIGTERM/SIGINT: stop starting batches,
 * let the running batch finish (bounded), then exit.
 */
function installShutdownHandlers(log: (msg: string) => void) {
  if (handlersInstalled) return
  handlersInstalled = true
  const onSignal = (signal: string) => {
    if (stopping) return
    stopping = true
    log(`Worker received ${signal}: finishing the current batch, then exiting`)
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, SHUTDOWN_GRACE_MS).unref())
    void Promise.race([current?.catch(() => undefined), timeout]).then(() => process.exit(0))
  }
  process.on('SIGTERM', () => onSignal('SIGTERM'))
  process.on('SIGINT', () => onSignal('SIGINT'))
}

/**
 * `payload worker --cron "* * * * *"` (docker/entrypoint.sh `worker` mode). Replaces spec §2's
 * `payload jobs:run --cron … --handle-schedules`: that command has a single --limit for all queues,
 * while the sync queue needs its own batch size.
 *
 * Exactly ONE worker may run: handleSchedules is not locked across processes.
 */
export const workerCommand = defineCLICommand({
  description: 'One worker tick: queue due schedules, then run default and sync jobs. Run with --cron "* * * * *".',
  input: strictObject({}),
  handler: async ({ getPayload }) => {
    const payload = await getPayload()
    installShutdownHandlers((msg) => payload.logger.info(msg))
    if (stopping) return
    // Make sure README HTML is current after a deploy: a queued, retried, single-flight job (cheap when nothing is
    // stale). Retried every tick until accepted, e.g. when the worker starts before web has migrated the jobs enum.
    if (!readmeRenderQueued && process.env.DIRECTORY_ROLE === 'worker') {
      try {
        await payload.jobs.queue({ task: 'render-readmes', input: {}, queue: QUEUES.default, overrideAccess: true })
        readmeRenderQueued = true
      } catch (err) {
        payload.logger.warn({ err }, 'Could not queue render-readmes yet; will retry next tick')
      }
    }
    // A directory with no templates yet (first deploy of templates) discovers them now instead of at the next
    // 6-hourly schedule. Same retry-until-accepted rule as above.
    if (!templateBootstrapDone && process.env.DIRECTORY_ROLE === 'worker') {
      try {
        if (await queueFirstTemplateDiscovery(payload)) payload.logger.info('No templates yet: queued discover-templates')
        templateBootstrapDone = true
      } catch (err) {
        payload.logger.warn({ err }, 'Could not check for first template discovery yet; will retry next tick')
      }
    }
    const tick = runWorkerTick(payload, { shouldStop: () => stopping })
    current = tick
    try {
      const { scheduled, ran } = await tick
      if (scheduled > 0 || Object.values(ran).some((n) => n > 0)) payload.logger.info({ scheduled, ran }, 'Worker tick')
    } finally {
      current = null
    }
  },
})
