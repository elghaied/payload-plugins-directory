import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { RepoRef } from './markdown'

export type ReadmeRenderer = (source: string, repo: RepoRef) => Promise<string | null>

export type IsolatedRenderOptions = {
  /** Wall-clock budget for the render itself (worker start-up is excluded). */
  timeoutMs?: number
  /** V8 old-generation heap limit of the worker thread. */
  maxOldGenerationSizeMb?: number
  /** Budget for the worker to load before it is abandoned. */
  startupTimeoutMs?: number
}

// Resolved from the working directory (the repo root in dev/tests, /app/cli in the worker container) rather than
// import.meta.url, so bundlers that include this module never try to trace or bundle the worker file.
const WORKER_FILE = join(/* turbopackIgnore: true */ process.cwd(), 'src/lib/directory/readmeWorker.mjs')

/**
 * Renders a README in a fresh worker thread with memory limits and a wall-clock timeout, then terminates it.
 * Resolves null (plain text) on a timeout, an out-of-memory kill, a crash or any error: it never rejects and a
 * hostile README cannot take the calling process down.
 */
export function renderReadmeIsolated(source: string, repo: RepoRef, options: IsolatedRenderOptions = {}): Promise<string | null> {
  const { timeoutMs = 2_000, maxOldGenerationSizeMb = 256, startupTimeoutMs = 20_000 } = options
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let worker: Worker | undefined
    const finish = (html: string | null) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      void worker?.terminate().catch(() => undefined)
      resolve(html)
    }
    try {
      worker = new Worker(WORKER_FILE, {
        resourceLimits: { maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
        stdout: true,
        stderr: true,
      })
    } catch {
      resolve(null)
      return
    }
    timer = setTimeout(() => finish(null), startupTimeoutMs)
    worker.on('message', (m: { type: string; html?: string | null }) => {
      if (m.type === 'ready') {
        clearTimeout(timer)
        timer = setTimeout(() => finish(null), timeoutMs)
        worker?.postMessage({ source, repo })
      } else if (m.type === 'result') {
        finish(typeof m.html === 'string' ? m.html : null)
      }
    })
    worker.on('error', () => finish(null)) // includes ERR_WORKER_OUT_OF_MEMORY
    worker.on('exit', () => finish(null))
  })
}
