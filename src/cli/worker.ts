import { strictObject } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { runWorkerTick } from '@/sync/worker'

/** Longest a SIGTERM waits for the running batch; keep below the compose `stop_grace_period`. */
const SHUTDOWN_GRACE_MS = 45_000

let stopping = false
let current: Promise<unknown> | null = null
let handlersInstalled = false

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
