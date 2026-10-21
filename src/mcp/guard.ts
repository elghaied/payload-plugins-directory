import { definePlugin, type PayloadHandler } from 'payload'

/** Largest request body accepted; an MCP call here is a few hundred bytes. */
export const MCP_MAX_BODY_BYTES = 16 * 1024

const rpcError = (status: number, code: number, message: string) =>
  Response.json({ jsonrpc: '2.0', id: null, error: { code, message } }, { status })

/** Reads at most `max` bytes; `null` when the body is larger. */
async function readCapped(request: Request, max: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > max) {
      // Not awaited: on a tee()'d clone, cancel() settles only once the other branch is cancelled too.
      void reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  return new TextDecoder().decode(Buffer.concat(chunks))
}

const noStore = (res: Response): Response => {
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', 'no-store')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}

/**
 * Wraps plugin-mcp's POST handler. Exactly one JSON-RPC call per request: batch arrays are refused
 * (the SDK would otherwise run up to 100 calls concurrently per HTTP request), the body is capped,
 * and every response is `Cache-Control: no-store`. Errors raised by the endpoint (e.g. the dev-only
 * overrideAccess guard) propagate to Payload's own error mapping.
 */
export const guardMcpPost = (inner: NonNullable<PayloadHandler>): PayloadHandler => async (req) => {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MCP_MAX_BODY_BYTES) return noStore(rpcError(413, -32600, 'Request body too large.'))
  const text = await readCapped((req as unknown as Request).clone(), MCP_MAX_BODY_BYTES)
  if (text === null) return noStore(rpcError(413, -32600, 'Request body too large.'))
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = undefined // the SDK answers malformed JSON with its own parse error
  }
  if (Array.isArray(parsed)) return noStore(rpcError(400, -32600, 'Batch requests are not supported: send one JSON-RPC call per request.'))
  return noStore(await inner(req))
}

/** Runs after plugin-mcp (order 10) and wraps its `/mcp` endpoints. */
export const mcpGuardPlugin = definePlugin({
  slug: 'directory-mcp-guard',
  order: 20,
  plugin: ({ config }) => ({
    ...config,
    endpoints: (config.endpoints ?? []).map((e) => {
      if (e.path !== '/mcp') return e
      const inner = e.handler as NonNullable<PayloadHandler>
      const handler: PayloadHandler = e.method === 'post' ? guardMcpPost(inner) : async (req) => noStore(await inner(req))
      return { ...e, handler }
    }),
  }),
})
