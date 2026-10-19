import 'dotenv/config'
import { vi } from 'vitest'

// Tests never reach the network: sync code takes an injected fetch (tests/helpers/fakeFetch.ts),
// and anything that falls back to the global one fails loudly here.
vi.stubGlobal('fetch', async (input: unknown) => {
  throw new Error(`Network access is disabled in tests (${String(input)})`)
})
