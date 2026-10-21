/**
 * A small process-wide budget for search DB work, shared by `/search` and the MCP tools (Task 9): at most
 * MAX_CONCURRENT searches run at once and at most MAX_QUEUED wait; beyond that the call is refused immediately instead
 * of piling work onto Postgres.
 */
export const SEARCH_MAX_CONCURRENT = 4
export const SEARCH_MAX_QUEUED = 32

export class SearchBusyError extends Error {
  constructor() {
    super('Search is busy, try again shortly')
    this.name = 'SearchBusyError'
  }
}

let running = 0
const waiting: (() => void)[] = []

async function acquire(): Promise<void> {
  if (running < SEARCH_MAX_CONCURRENT) {
    running++
    return
  }
  if (waiting.length >= SEARCH_MAX_QUEUED) throw new SearchBusyError()
  // The slot is handed over directly by release(), so `running` stays accurate.
  await new Promise<void>((resolve) => waiting.push(resolve))
}

function release(): void {
  const next = waiting.shift()
  if (next) next()
  else running--
}

export async function withSearchBudget<T>(fn: () => Promise<T>): Promise<T> {
  await acquire()
  try {
    return await fn()
  } finally {
    release()
  }
}

/** For tests. */
export const searchBudgetState = () => ({ running, queued: waiting.length })
