import type { EnrichMessage, EnrichUsage } from './types'

export type Interpretation = { ok: true; json: unknown } | { ok: false; reason: string }

/**
 * Reads a model answer. `stop_reason` is checked before `content` (a refusal or a cut-off answer may not match
 * the schema). Structured output arrives as the JSON text block; thinking blocks are skipped.
 */
export function interpretMessage(message: EnrichMessage): Interpretation {
  if (message.stop_reason === 'refusal') return { ok: false, reason: `refusal:${message.stop_details?.category ?? 'unknown'}` }
  if (message.stop_reason === 'max_tokens') return { ok: false, reason: 'max_tokens' }
  if (message.stop_reason !== 'end_turn') return { ok: false, reason: `stop:${message.stop_reason ?? 'none'}` }
  const text = message.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  if (!text) return { ok: false, reason: 'no-output' }
  try {
    return { ok: true, json: JSON.parse(text) as unknown }
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }
}

export const ZERO_USAGE: EnrichUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }

export function usageOf(message: EnrichMessage): EnrichUsage {
  return {
    input: message.usage.input_tokens,
    output: message.usage.output_tokens,
    cacheRead: message.usage.cache_read_input_tokens ?? 0,
    cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
  }
}

export const addUsage = (a: EnrichUsage, b: EnrichUsage): EnrichUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
})
