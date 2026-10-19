/** Types shared by the enrichment prompt, validator, client and tasks (spec §5). */
export type EnrichSettings = { enabled: boolean; model: string; instructions: string; maxNewTagsPerPlugin: number }

export type TagRef = { id: number; slug: string; title: string; aliases: string[]; createdBy: 'admin' | 'alias' | 'ai' }

/** Author-controlled data sent as untrusted content (spec §5.2). */
export type PluginInput = {
  name: string
  packageName: string | null
  description: string | null
  topics: string[]
  keywords: string[]
  payloadVersionRange: string | null
  readme: string | null
}

/** A model answer after server-side validation: the only shape that is ever written. */
export type CleanEnrichment = {
  category: string
  tags: { existing: string[]; created: { slug: string; title: string }[] }
  tagline: string
  summary: string
  features: string[]
  useCases: string[]
  confidence: number
}

/** Messages API body. Direct calls add the refusal-fallback beta in the client; batches send it as is. */
export type EnrichRequest = {
  model: string
  max_tokens: number
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[]
  messages: { role: 'user'; content: string }[]
  output_config: { effort: 'low'; format: { type: 'json_schema'; schema: Record<string, unknown> } }
}

export type EnrichUsage = { input: number; output: number; cacheRead: number; cacheWrite: number }

/** The part of an Anthropic Message enrichment reads. */
export type EnrichMessage = {
  model: string
  stop_reason: string | null
  stop_details?: { category?: string | null } | null
  content: { type: string; text?: string }[]
  usage: {
    input_tokens: number
    output_tokens: number
    cache_read_input_tokens?: number | null
    cache_creation_input_tokens?: number | null
  }
}

export type BatchItem = { custom_id: string; params: EnrichRequest }
export type BatchInfo = { id: string; processing_status: 'in_progress' | 'canceling' | 'ended' }
export type BatchResultEntry = {
  custom_id: string
  result: { type: 'succeeded'; message: EnrichMessage } | { type: 'errored' | 'canceled' | 'expired' }
}

/** Everything enrichment needs from Anthropic. Production: src/enrich/client.ts; tests: tests/helpers/fakeEnrichClient.ts. */
export interface EnrichClient {
  /** One direct request (with server-side refusal fallback). Throws on API/transport errors. */
  createMessage(request: EnrichRequest): Promise<EnrichMessage>
  createBatch(items: BatchItem[]): Promise<BatchInfo>
  retrieveBatch(id: string): Promise<BatchInfo>
  /** Results arrive in any order, keyed by custom_id. */
  batchResults(id: string): AsyncIterable<BatchResultEntry>
  cancelBatch(id: string): Promise<void>
}
