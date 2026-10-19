import Anthropic from '@anthropic-ai/sdk'
import type { BatchInfo, BatchItem, BatchResultEntry, EnrichClient, EnrichMessage, EnrichRequest } from './types'

/**
 * Server-side refusal fallback, scalar form (`fallbacks: 'default'`). On Sonnet 5.5 it re-runs "cyber" and
 * "frontier_llm" declines on another model inside the same call; other categories stay refused. The array form
 * needs a different header. The Batches API rejects the parameter.
 */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** The SDK surface enrichment uses. Tests pass a stub; production wraps a real `Anthropic` instance. */
export type AnthropicLike = {
  beta: { messages: { create: (body: Record<string, unknown>, options?: { maxRetries?: number }) => Promise<unknown> } }
  messages: {
    batches: {
      create: (body: { requests: BatchItem[] }, options?: { maxRetries?: number }) => Promise<{ id: string; processing_status: string }>
      retrieve: (id: string) => Promise<{ id: string; processing_status: string }>
      results: (id: string) => Promise<AsyncIterable<unknown>>
      cancel: (id: string) => Promise<unknown>
    }
  }
}

const toInfo = (b: { id: string; processing_status: string }): BatchInfo => ({
  id: b.id,
  processing_status: b.processing_status as BatchInfo['processing_status'],
})

/** The direct-request body: the shared request plus the refusal-fallback opt-in. Checked against the SDK's own type. */
const directBody = (request: EnrichRequest) =>
  ({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' }) satisfies Anthropic.Beta.Messages.MessageCreateParamsNonStreaming

export function createEnrichClient(sdk: AnthropicLike): EnrichClient {
  return {
    async createMessage(request: EnrichRequest) {
      // No SDK retries on the paid call (final review Minor 3): the enrich job already retries (3 attempts, exponential
      // backoff, retry-after honoured), and SDK retries on top multiplied that to 12 attempts, each billed when a
      // timeout hit after the server had done the work. One layer of retries, the one with backoff and visibility.
      // Reads (retrieve, results, cancel) keep the client's SDK retries: they are free.
      const options = { maxRetries: 0 } satisfies Parameters<Anthropic['beta']['messages']['create']>[1]
      return (await sdk.beta.messages.create(directBody(request), options)) as EnrichMessage
    },
    // Batches reject `fallbacks`; refused batch items are re-run as direct requests (src/enrich/batch.ts).
    async createBatch(items: BatchItem[]) {
      const body = { requests: items } satisfies Anthropic.Messages.BatchCreateParams
      // No SDK retries: batch creation carries no idempotency key, so a retried POST after a lost response could
      // create (and bill) a second batch. A failed create surfaces; the in-flight marker (batch.ts) guards the rest.
      const options = { maxRetries: 0 } satisfies Parameters<Anthropic['messages']['batches']['create']>[1]
      return toInfo(await sdk.messages.batches.create(body, options))
    },
    async retrieveBatch(id: string) {
      return toInfo(await sdk.messages.batches.retrieve(id))
    },
    async *batchResults(id: string) {
      for await (const entry of await sdk.messages.batches.results(id)) yield entry as BatchResultEntry
    },
    async cancelBatch(id: string) {
      await sdk.messages.batches.cancel(id)
    },
  }
}

let warnedLocal = false

/** Real requests cost money: only a production worker sends them, or a local one that explicitly opts in. */
export const enrichAllowedHere = (env: Record<string, string | undefined>): boolean =>
  env.NODE_ENV === 'production' || env.ENRICH_ALLOW_LOCAL === '1'

/**
 * The real client, from ANTHROPIC_API_KEY (set on the worker only, spec §12). `null` when unset: enrichment is
 * skipped and plugins keep their author description and "Uncategorized" (spec §5.5). Also `null` outside production
 * unless ENRICH_ALLOW_LOCAL=1 (final review Minor 4): a local `pnpm worker` loads the real key from `.env` and, after
 * `db:pull`, inherits production's jobs; it must not bill requests or collect production's batch. Logged once.
 */
export function enrichClientFromEnv(
  env: Record<string, string | undefined> = process.env,
  log: (message: string) => void = console.warn,
): EnrichClient | null {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) return null
  if (!enrichAllowedHere(env)) {
    if (!warnedLocal) {
      warnedLocal = true
      log('AI enrichment is off outside production (NODE_ENV is not "production"): set ENRICH_ALLOW_LOCAL=1 to send real, billed requests from this process.')
    }
    return null
  }
  return createEnrichClient(new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 }) as unknown as AnthropicLike)
}

export type AnthropicErrorClass =
  /** Fails the same way on every attempt (bad request, bad key, no permission, unknown model): do not retry (ruling F16). */
  | { kind: 'permanent'; status: number }
  /** Rate limit, server error, overloaded (529) or connection failure: retry, not before `retryAt` when known. */
  | { kind: 'transient'; status: number | null; retryAt: Date | null }
  /** Not an SDK error, or a status the ruling does not cover: the caller's default handling applies. */
  | { kind: 'other' }

function retryAt(headers: Headers | undefined, now: Date): Date | null {
  const ms = Number(headers?.get('retry-after-ms'))
  if (Number.isFinite(ms) && ms > 0) return new Date(now.getTime() + ms)
  const seconds = Number(headers?.get('retry-after'))
  if (Number.isFinite(seconds) && seconds > 0) return new Date(now.getTime() + seconds * 1000)
  return null
}

/**
 * Classifies an error thrown by the SDK, by its typed error class (never by message text). The SDK has already
 * retried transient failures `maxRetries` times by the time one reaches us.
 */
export function classifyAnthropicError(err: unknown, now: Date = new Date()): AnthropicErrorClass {
  if (
    err instanceof Anthropic.BadRequestError ||
    err instanceof Anthropic.AuthenticationError ||
    err instanceof Anthropic.PermissionDeniedError ||
    // An unknown or retired model id (directory-settings.ai.model): fails until an admin changes it.
    err instanceof Anthropic.NotFoundError
  ) {
    return { kind: 'permanent', status: err.status }
  }
  // APIConnectionTimeoutError extends APIConnectionError; 529 overloaded arrives as InternalServerError (status >= 500).
  if (err instanceof Anthropic.APIConnectionError) return { kind: 'transient', status: null, retryAt: null }
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) {
    return { kind: 'transient', status: err.status, retryAt: retryAt(err.headers, now) }
  }
  return { kind: 'other' }
}

/**
 * The API answered with an HTTP status, so the request was certainly not executed (batch create: no batch exists).
 * Connection errors, timeouts and aborts are APIErrors without a status: their outcome is unknown.
 */
export const isDefiniteCreateFailure = (err: unknown): boolean =>
  err instanceof Anthropic.APIError &&
  !(err instanceof Anthropic.APIConnectionError) &&
  !(err instanceof Anthropic.APIUserAbortError) &&
  typeof err.status === 'number'

/** The batch id is unknown to the API (404): there is nothing left to poll or collect. */
export const isBatchNotFound = (err: unknown): boolean => err instanceof Anthropic.NotFoundError

export const isPermanentAnthropicError = (err: unknown): boolean => classifyAnthropicError(err).kind === 'permanent'
