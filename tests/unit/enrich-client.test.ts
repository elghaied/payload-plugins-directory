import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  classifyAnthropicError,
  createEnrichClient,
  enrichClientFromEnv,
  FALLBACK_BETA,
  isPermanentAnthropicError,
  type AnthropicLike,
} from '@/enrich/client'
import { addUsage, interpretMessage, usageOf, ZERO_USAGE } from '@/enrich/response'
import type { BatchItem, EnrichRequest } from '@/enrich/types'
import { maxTokensMessage, okMessage, refusalMessage } from '../helpers/fakeEnrichClient'

const request: EnrichRequest = {
  model: 'claude-sonnet-5-5',
  max_tokens: 4000,
  system: [{ type: 'text', text: 'S', cache_control: { type: 'ephemeral' } }],
  messages: [{ role: 'user', content: 'U' }],
  output_config: { effort: 'low', format: { type: 'json_schema', schema: { type: 'object' } } },
}

function stubSdk() {
  type Info = { id: string; processing_status: string }
  return {
    beta: { messages: { create: vi.fn<(body: Record<string, unknown>) => Promise<unknown>>(async () => okMessage({ a: 1 })) } },
    messages: {
      batches: {
        create: vi.fn<(body: { requests: BatchItem[] }) => Promise<Info>>(async () => ({ id: 'msgbatch_1', processing_status: 'in_progress' })),
        retrieve: vi.fn<(id: string) => Promise<Info>>(async () => ({ id: 'msgbatch_1', processing_status: 'ended' })),
        results: vi.fn<(id: string) => Promise<AsyncIterable<unknown>>>(async () =>
          (async function* () {
            yield { custom_id: 'plugin-1', result: { type: 'expired' } }
          })(),
        ),
        cancel: vi.fn<(id: string) => Promise<unknown>>(async () => ({})),
      },
    },
  }
}

describe('createEnrichClient', () => {
  it('sends direct requests with the default server-side refusal fallback', async () => {
    const sdk = stubSdk()
    const message = await createEnrichClient(sdk as unknown as AnthropicLike).createMessage(request)
    expect(FALLBACK_BETA).toBe('server-side-fallback-2026-07-01')
    expect(sdk.beta.messages.create).toHaveBeenCalledWith({ ...request, betas: [FALLBACK_BETA], fallbacks: 'default' })
    const body = sdk.beta.messages.create.mock.calls[0][0]
    expect(body).not.toHaveProperty('thinking')
    expect(body).not.toHaveProperty('tool_choice')
    expect(interpretMessage(message)).toEqual({ ok: true, json: { a: 1 } })
  })

  it('sends batches without fallbacks or betas (the Batches API rejects them)', async () => {
    const sdk = stubSdk()
    const client = createEnrichClient(sdk as unknown as AnthropicLike)
    expect(await client.createBatch([{ custom_id: 'plugin-1', params: request }])).toEqual({ id: 'msgbatch_1', processing_status: 'in_progress' })
    const body = sdk.messages.batches.create.mock.calls[0][0]
    expect(body).toEqual({ requests: [{ custom_id: 'plugin-1', params: request }] })
    expect(JSON.stringify(body)).not.toMatch(/fallbacks|betas/)
    expect(await client.retrieveBatch('msgbatch_1')).toEqual({ id: 'msgbatch_1', processing_status: 'ended' })
    const results: unknown[] = []
    for await (const r of client.batchResults('msgbatch_1')) results.push(r)
    expect(results).toEqual([{ custom_id: 'plugin-1', result: { type: 'expired' } }])
    await client.cancelBatch('msgbatch_1')
    expect(sdk.messages.batches.cancel).toHaveBeenCalledWith('msgbatch_1')
  })

  it('has no client without ANTHROPIC_API_KEY, and tests never see a key', () => {
    expect(process.env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(enrichClientFromEnv({})).toBeNull()
    expect(enrichClientFromEnv({ ANTHROPIC_API_KEY: '' })).toBeNull()
    expect(enrichClientFromEnv({ ANTHROPIC_API_KEY: 'sk-test' })).not.toBeNull() // constructs only; sends nothing
  })
})

describe('classifyAnthropicError (ruling F16)', () => {
  const now = new Date('2026-10-19T12:00:00Z')
  const headers = (h: Record<string, string> = {}) => new Headers(h)
  const apiError = (status: number, h: Record<string, string> = {}, type = 'api_error') =>
    Anthropic.APIError.generate(status, { error: { type, message: 'x' } }, 'x', headers(h))

  it('treats 400/401/403 as permanent: retrying cannot help', () => {
    for (const status of [400, 401, 403]) {
      const err = apiError(status)
      expect(classifyAnthropicError(err, now)).toEqual({ kind: 'permanent', status })
      expect(isPermanentAnthropicError(err)).toBe(true)
    }
    expect(apiError(400)).toBeInstanceOf(Anthropic.BadRequestError)
    expect(apiError(401)).toBeInstanceOf(Anthropic.AuthenticationError)
    expect(apiError(403)).toBeInstanceOf(Anthropic.PermissionDeniedError)
  })

  it('treats 429, 5xx, overloaded (529) and connection failures as transient, with retry-after when sent', () => {
    expect(classifyAnthropicError(apiError(429, { 'retry-after': '30' }, 'rate_limit_error'), now)).toEqual({
      kind: 'transient', status: 429, retryAt: new Date('2026-10-19T12:00:30Z'),
    })
    expect(classifyAnthropicError(apiError(429, { 'retry-after-ms': '1500' }), now)).toEqual({
      kind: 'transient', status: 429, retryAt: new Date('2026-10-19T12:00:01.500Z'),
    })
    expect(classifyAnthropicError(apiError(500), now)).toEqual({ kind: 'transient', status: 500, retryAt: null })
    const overloaded = apiError(529, {}, 'overloaded_error')
    expect(overloaded).toBeInstanceOf(Anthropic.InternalServerError)
    expect(classifyAnthropicError(overloaded, now)).toEqual({ kind: 'transient', status: 529, retryAt: null })
    expect(classifyAnthropicError(new Anthropic.APIConnectionError({ message: 'down' }), now)).toEqual({
      kind: 'transient', status: null, retryAt: null,
    })
    expect(classifyAnthropicError(new Anthropic.APIConnectionTimeoutError(), now).kind).toBe('transient')
    expect(isPermanentAnthropicError(apiError(429))).toBe(false)
    expect(isPermanentAnthropicError(apiError(529))).toBe(false)
  })

  it('leaves anything that is not an SDK error to the caller', () => {
    expect(classifyAnthropicError(new Error('HTTP 401'), now)).toEqual({ kind: 'other' })
    expect(classifyAnthropicError(apiError(404), now)).toEqual({ kind: 'other' })
    expect(isPermanentAnthropicError(new Error('authentication_error'))).toBe(false)
  })
})

describe('interpretMessage', () => {
  it('reads the JSON text block, skipping thinking blocks', () => {
    expect(interpretMessage(okMessage({ category: 'other' }))).toEqual({ ok: true, json: { category: 'other' } })
  })
  it('checks stop_reason before reading content', () => {
    expect(interpretMessage(refusalMessage('cyber'))).toEqual({ ok: false, reason: 'refusal:cyber' })
    expect(interpretMessage(refusalMessage(null))).toEqual({ ok: false, reason: 'refusal:unknown' })
    expect(interpretMessage(maxTokensMessage())).toEqual({ ok: false, reason: 'max_tokens' })
    expect(interpretMessage(okMessage({}, { stop_reason: 'model_context_window_exceeded' }))).toEqual({
      ok: false, reason: 'stop:model_context_window_exceeded',
    })
  })
  it('reports empty and non-JSON output', () => {
    expect(interpretMessage(okMessage('', { content: [{ type: 'thinking' }] }))).toEqual({ ok: false, reason: 'no-output' })
    expect(interpretMessage(okMessage('not json'))).toEqual({ ok: false, reason: 'invalid-json' })
  })
  it('extracts and adds usage, including cache reads', () => {
    const u = usageOf(okMessage({}))
    expect(u).toEqual({ input: 6000, output: 800, cacheRead: 2500, cacheWrite: 0 })
    expect(addUsage(addUsage(ZERO_USAGE, u), u)).toEqual({ input: 12000, output: 1600, cacheRead: 5000, cacheWrite: 0 })
  })
})
