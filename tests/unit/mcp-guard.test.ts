import { describe, expect, it } from 'vitest'
import { APIError, type PayloadRequest } from 'payload'
import { guardMcpPost } from '@/mcp/guard'

const post = (body: string) =>
  new Request('http://localhost/api/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body }) as unknown as PayloadRequest
const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })

describe('guardMcpPost errors', () => {
  it('an APIError thrown by the inner handler becomes a no-store response with its status', async () => {
    const guarded = guardMcpPost(async () => {
      throw new APIError('overrideAccess is not allowed here.', 400)
    })
    const res = await guarded(post(body))
    expect(res.status).toBe(400)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(JSON.stringify(await res.json())).toContain('overrideAccess is not allowed here.')
  })
  it('an unexpected error becomes a generic no-store 500 without its message', async () => {
    const guarded = guardMcpPost(async () => {
      throw new Error('secret connection string postgres://u:p@h/db')
    })
    const res = await guarded(post(body))
    expect(res.status).toBe(500)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).not.toContain('postgres://')
  })
})
