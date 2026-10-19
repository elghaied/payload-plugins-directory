/** The only way sync code reaches the network: injected so tests can pass a fake. */
export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>

export type RateLimitSource = 'github' | 'npm'

/** GitHub or npm said "slow down". Tasks re-queue themselves with `waitUntil` = `resetAt` instead of failing. */
export class RateLimitError extends Error {
  readonly source: RateLimitSource
  readonly resetAt: Date
  /** Input for the re-queued job when it differs from the current one (npm-stats: the slugs not yet fetched). */
  readonly requeueInput?: Record<string, unknown>

  constructor(source: RateLimitSource, resetAt: Date, requeueInput?: Record<string, unknown>) {
    super(`${source} rate limit reached; resets at ${resetAt.toISOString()}`)
    this.name = 'RateLimitError'
    this.source = source
    this.resetAt = resetAt
    this.requeueInput = requeueInput
  }

  withRequeueInput(input: Record<string, unknown>): RateLimitError {
    return new RateLimitError(this.source, this.resetAt, input)
  }
}

/** Any failure other than 404 and rate limits. Clients return null for 404 and never throw HttpError for it. */
export class HttpError extends Error {
  readonly status: number
  readonly url: string

  constructor(status: number, url: string) {
    super(`HTTP ${status} for ${url}`)
    this.name = 'HttpError'
    this.status = status
    this.url = url
  }
}

/** When a 403/429 response is a rate limit, the time it lifts; otherwise null. */
export function rateLimitResetAt(res: Response, now: Date): Date | null {
  if (res.status !== 403 && res.status !== 429) return null
  const retryAfter = res.headers.get('retry-after')
  if (retryAfter && /^\d+$/.test(retryAfter)) return new Date(now.getTime() + Number(retryAfter) * 1000)
  if (res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset'))
    if (Number.isFinite(reset) && reset > 0) return new Date(reset * 1000)
  }
  return res.status === 429 ? new Date(now.getTime() + 60_000) : null
}
