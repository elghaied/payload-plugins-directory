import type { Payload, Where } from 'payload'
import { loadEnrichContext, toPluginInput } from './context'
import { buildRequest } from './prompt'

/** Rough sizing only: ~4 characters per token for English prose and code. No tokenizer, no API call. */
const CHARS_PER_TOKEN = 4
/** The answer is about 1k tokens (adaptive thinking at effort "low" adds a little). */
const EST_OUTPUT_TOKENS = 1_000
type Prices = { input: number; output: number; cacheRead: number; cacheWrite: number }
/** USD per million tokens, per model. cacheWrite is 1.25x input. */
export const PRICES: Record<string, Prices> = {
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}
const FALLBACK_MODEL = 'claude-sonnet-5-5'

export type PreviewItem = {
  slug: string
  model: string
  systemChars: number
  userChars: number
  estInputTokens: number
  estOutputTokens: number
  /** False when the model has no price entry: the estimate then uses Sonnet 5.5 prices and is a guess. */
  priceKnown: boolean
  /** Estimated cost of the first request of a pass: the system prompt is written to the cache (write premium). */
  estCostUsd: number
  /** Estimated cost once the system prompt is a cache read (every request after the first in a pass). */
  estCostCachedUsd: number
}

const tokensOf = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN)

/**
 * Dry run for the manual quality check: builds the exact request each plugin would send and reports its size and
 * estimated cost. It makes NO API call and NO database write, so it needs no API key.
 * Without `slugs` it takes the `limit` (default 5) healthiest listed plugins that have a README.
 */
export async function previewEnrichment(payload: Payload, opts: { slugs?: string[]; limit?: number } = {}): Promise<PreviewItem[]> {
  const ctx = await loadEnrichContext(payload)
  if (!ctx.leaves.length) throw new Error('No leaf categories exist, so nothing can be classified. Run `payload seed-taxonomy` first.')
  const where: Where = opts.slugs?.length
    ? { slug: { in: opts.slugs } }
    : { and: [{ visibility: { equals: 'listed' } }, { readme: { exists: true } }] }
  const res = await payload.find({
    collection: 'plugins',
    overrideAccess: true,
    depth: 1,
    limit: opts.slugs?.length ? opts.slugs.length : (opts.limit ?? 5),
    sort: '-healthScore',
    where,
  })
  return res.docs.map((plugin) => {
    const request = buildRequest({ model: ctx.settings.model, system: ctx.system, schema: ctx.schema }, toPluginInput(plugin))
    const systemChars = request.system.reduce((n, b) => n + b.text.length, 0)
    const userChars = request.messages.reduce((n, m) => n + m.content.length, 0)
    const schemaTokens = tokensOf(JSON.stringify(request.output_config.format.schema).length)
    const systemTokens = tokensOf(systemChars)
    const rest = tokensOf(userChars) + schemaTokens
    const known = request.model in PRICES
    const price = PRICES[known ? request.model : FALLBACK_MODEL]
    const cost = (systemRate: number) => (systemTokens * systemRate + rest * price.input + EST_OUTPUT_TOKENS * price.output) / 1e6
    return {
      slug: plugin.slug,
      model: request.model,
      systemChars,
      userChars,
      estInputTokens: systemTokens + rest,
      estOutputTokens: EST_OUTPUT_TOKENS,
      priceKnown: known,
      estCostUsd: cost(price.cacheWrite),
      estCostCachedUsd: cost(price.cacheRead),
    }
  })
}
