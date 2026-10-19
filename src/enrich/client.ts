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
  beta: { messages: { create: (body: Record<string, unknown>) => Promise<unknown> } }
  messages: {
    batches: {
      create: (body: { requests: BatchItem[] }) => Promise<{ id: string; processing_status: string }>
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
      return (await sdk.beta.messages.create(directBody(request))) as EnrichMessage
    },
    // Batches reject `fallbacks`; refused batch items are re-run as direct requests (src/enrich/batch.ts).
    async createBatch(items: BatchItem[]) {
      const body = { requests: items } satisfies Anthropic.Messages.BatchCreateParams
      return toInfo(await sdk.messages.batches.create(body))
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

/**
 * The real client, from ANTHROPIC_API_KEY (set on the worker only, spec §12). `null` when unset: enrichment is
 * skipped and plugins keep their author description and "Uncategorized" (spec §5.5).
 */
export function enrichClientFromEnv(env: Record<string, string | undefined> = process.env): EnrichClient | null {
  const apiKey = env.ANTHROPIC_API_KEY
  if (!apiKey) return null
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

export const isPermanentAnthropicError = (err: unknown): boolean => classifyAnthropicError(err).kind === 'permanent'
