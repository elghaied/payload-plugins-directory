import type { Payload, Where } from 'payload'
import { loadEnrichContext, toPluginInput } from './context'
import { buildRequest } from './prompt'

/** Rough sizing only: ~4 characters per token for English prose and code. No tokenizer, no API call. */
const CHARS_PER_TOKEN = 4
/** The answer is about 1k tokens (adaptive thinking at effort "low" adds a little). */
const EST_OUTPUT_TOKENS = 1_000
/** Assumed list price in USD per million tokens. An estimate to judge order of magnitude, not a quote; adjust if pricing changes. */
const PRICE_PER_MTOK = { input: 3, output: 15, cacheRead: 0.3 }

export type PreviewItem = {
  slug: string
  model: string
  systemChars: number
  userChars: number
  estInputTokens: number
  estOutputTokens: number
  /** Estimated cost of this request when its system prompt is not yet cached. */
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
    const cost = (systemRate: number) =>
      (systemTokens * systemRate + rest * PRICE_PER_MTOK.input + EST_OUTPUT_TOKENS * PRICE_PER_MTOK.output) / 1e6
    return {
      slug: plugin.slug,
      model: request.model,
      systemChars,
      userChars,
      estInputTokens: systemTokens + rest,
      estOutputTokens: EST_OUTPUT_TOKENS,
      estCostUsd: cost(PRICE_PER_MTOK.input),
      estCostCachedUsd: cost(PRICE_PER_MTOK.cacheRead),
    }
  })
}
