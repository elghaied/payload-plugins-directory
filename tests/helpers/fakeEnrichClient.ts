import type { BatchInfo, BatchItem, BatchResultEntry, EnrichClient, EnrichMessage, EnrichRequest } from '@/enrich/types'

/** A successful structured-output answer; a (display-omitted) thinking block comes first, as on Sonnet 5.5. */
export const okMessage = (json: unknown, over: Partial<EnrichMessage> = {}): EnrichMessage => ({
  model: 'claude-sonnet-5-5',
  stop_reason: 'end_turn',
  content: [{ type: 'thinking' }, { type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
  usage: { input_tokens: 6000, output_tokens: 800, cache_read_input_tokens: 2500, cache_creation_input_tokens: 0 },
  ...over,
})
export const refusalMessage = (category: string | null = 'cyber'): EnrichMessage =>
  okMessage('', { stop_reason: 'refusal', stop_details: { category }, content: [] })
export const maxTokensMessage = (): EnrichMessage => okMessage('{"category":"cloud-st', { stop_reason: 'max_tokens' })

export type FakeBatch = { items: BatchItem[]; status: BatchInfo['processing_status']; results: BatchResultEntry[]; cancelled: boolean }
export type FakeEnrichClient = EnrichClient & { calls: EnrichRequest[]; batches: Map<string, FakeBatch> }

/** In-memory EnrichClient: records every request; never touches the network. */
export function fakeEnrichClient(
  respond: (request: EnrichRequest, index: number) => EnrichMessage | Promise<EnrichMessage> = () => {
    throw new Error('fakeEnrichClient: unexpected createMessage')
  },
): FakeEnrichClient {
  const calls: EnrichRequest[] = []
  const batches = new Map<string, FakeBatch>()
  const batch = (id: string) => {
    const b = batches.get(id)
    if (!b) throw new Error(`fakeEnrichClient: unknown batch ${id}`)
    return b
  }
  return {
    calls,
    batches,
    async createMessage(request) {
      calls.push(request)
      return respond(request, calls.length - 1)
    },
    async createBatch(items) {
      const id = `msgbatch_${batches.size + 1}`
      batches.set(id, { items, status: 'in_progress', results: [], cancelled: false })
      return { id, processing_status: 'in_progress' }
    },
    async retrieveBatch(id) {
      return { id, processing_status: batch(id).status }
    },
    async *batchResults(id) {
      yield* batch(id).results
    },
    async cancelBatch(id) {
      const b = batch(id)
      b.cancelled = true
      b.status = 'canceling'
    },
  }
}

/** Marks a fake batch as ended with the given results (any order, like the real API). */
export function endBatch(fake: FakeEnrichClient, id: string, results: BatchResultEntry[]): void {
  const b = fake.batches.get(id)
  if (!b) throw new Error(`endBatch: unknown batch ${id}`)
  b.status = 'ended'
  b.results = results
}
