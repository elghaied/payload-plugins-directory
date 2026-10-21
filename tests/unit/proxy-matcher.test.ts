import { describe, expect, it } from 'vitest'
import { unstable_doesMiddlewareMatch as matches } from 'next/experimental/testing/server'
import { config } from '@/proxy'

// Next buffers up to 10 MB of every request body for paths the proxy matches. /api/mcp must stay out of it:
// its own guard caps the body at 16 KB and the proxy only adds an X-Robots-Tag that is meaningless on JSON-RPC.
describe('proxy matcher', () => {
  it.each(['/api/mcp', '/api/mcp/', '/api/mcp?x=1'])('does not run for %s', (url) => {
    expect(matches({ config, url })).toBe(false)
  })
  it.each(['/', '/search', '/about', '/api/health', '/api/plugins', '/admin', '/plugins/x'])('still runs for %s', (url) => {
    expect(matches({ config, url })).toBe(true)
  })
})
