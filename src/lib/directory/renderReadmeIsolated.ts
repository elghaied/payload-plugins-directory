import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type { RepoRef } from './markdown'

/** `html` null = plain text; `reason` says why (cap:<which>, size, error, timeout, startup-timeout, oom, crash). */
export type ReadmeRenderResult = { html: string | null; reason?: string }
export type ReadmeRenderer = (source: string, repo: RepoRef) => Promise<ReadmeRenderResult>

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
 * Resolves `{ html: null, reason }` (plain text) on a timeout, an out-of-memory kill, a crash or any error: it never rejects and a
 * hostile README cannot take the calling process down.
 */
export function renderReadmeIsolated(source: string, repo: RepoRef, options: IsolatedRenderOptions = {}): Promise<ReadmeRenderResult> {
  const { timeoutMs = 2_000, maxOldGenerationSizeMb = 256, startupTimeoutMs = 20_000 } = options
  return new Promise((resolve) => {
    let settled = false
    let timer: NodeJS.Timeout | undefined
    let worker: Worker | undefined
    const finish = (result: ReadmeRenderResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      void worker?.terminate().catch(() => undefined)
      resolve(result)
    }
    try {
      worker = new Worker(WORKER_FILE, {
        resourceLimits: { maxOldGenerationSizeMb, maxYoungGenerationSizeMb: 64, stackSizeMb: 4 },
        stdout: true,
        stderr: true,
      })
    } catch {
      resolve({ html: null, reason: 'crash' })
      return
    }
    timer = setTimeout(() => finish({ html: null, reason: 'startup-timeout' }), startupTimeoutMs)
    worker.on('message', (m: { type: string; html?: string | null; reason?: string }) => {
      if (m.type === 'ready') {
        clearTimeout(timer)
        timer = setTimeout(() => finish({ html: null, reason: 'timeout' }), timeoutMs)
        worker?.postMessage({ source, repo })
      } else if (m.type === 'result') {
        finish(typeof m.html === 'string' ? { html: m.html } : { html: null, reason: m.reason ?? 'error' })
      }
    })
    worker.on('error', (err: NodeJS.ErrnoException) => finish({ html: null, reason: err.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'oom' : 'crash' }))
    worker.on('exit', () => finish({ html: null, reason: 'crash' }))
  })
}
