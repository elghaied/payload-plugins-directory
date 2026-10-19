import 'dotenv/config'
// `.env` may hold a real key for the optional manual quality check; tests must never see it.
// Enrichment code falls back to "no client" when the key is absent (src/enrich/client.ts).
delete process.env.ANTHROPIC_API_KEY
import { vi } from 'vitest'

// Tests never reach the network: sync code takes an injected fetch (tests/helpers/fakeFetch.ts),
// and anything that falls back to the global one fails loudly here.
vi.stubGlobal('fetch', async (input: unknown) => {
  throw new Error(`Network access is disabled in tests (${String(input)})`)
})

// Session tokens are signed in unit and integration tests; set unconditionally so a real secret in `.env` is never used.
process.env.SESSION_SECRET = 'test-session-secret-0123456789abcdef-0123456789'
