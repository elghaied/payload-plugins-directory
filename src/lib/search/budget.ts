/**
 * A small process-wide budget for search DB work, shared by `/search` and the MCP tools (Task 9): at most
 * MAX_CONCURRENT searches run at once and at most MAX_QUEUED wait; beyond that the call is refused immediately instead
 * of piling work onto Postgres.
 */
export const SEARCH_MAX_CONCURRENT = 4
export const SEARCH_MAX_QUEUED = 32
/** A queued search waits at most this long before it is refused as busy. */
export const SEARCH_QUEUE_TIMEOUT_MS = 5_000

export class SearchBusyError extends Error {
  constructor() {
    super('Search is busy, try again shortly')
    this.name = 'SearchBusyError'
  }
}

let running = 0
const waiting: (() => void)[] = []

async function acquire(queueTimeoutMs: number): Promise<void> {
  if (running < SEARCH_MAX_CONCURRENT) {
    running++
    return
  }
  if (waiting.length >= SEARCH_MAX_QUEUED) throw new SearchBusyError()
  // The slot is handed over directly by release(), so `running` stays accurate.
  await new Promise<void>((resolve, reject) => {
    const entry = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      const i = waiting.indexOf(entry)
      if (i >= 0) waiting.splice(i, 1)
      reject(new SearchBusyError())
    }, queueTimeoutMs)
    waiting.push(entry)
  })
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else running--
}

export async function withSearchBudget<T>(fn: () => Promise<T>, opts: { queueTimeoutMs?: number } = {}): Promise<T> {
  await acquire(opts.queueTimeoutMs ?? SEARCH_QUEUE_TIMEOUT_MS)
  try {
    return await fn()
  } finally {
    release()
  }
}

/** For tests. */
export const searchBudgetState = () => ({ running, queued: waiting.length })
