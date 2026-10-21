/* eslint-disable @typescript-eslint/no-explicit-any -- JSON-RPC bodies are untyped test data */
import { handleEndpoints, type Payload } from 'payload'

export type RpcInit = { headers?: Record<string, string>; query?: string; rawBody?: string }

/** POSTs to /api/mcp through Payload's real routing (auth strategies, endpoint lookup, error mapping), as the REST route does. */
export async function mcpRequest(payload: Payload, method: string, params: Record<string, unknown> = {}, init: RpcInit = {}): Promise<Response> {
  const request = new Request(`http://localhost/api/mcp${init.query ?? ''}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': '2025-06-18',
      ...init.headers,
    },
    body: init.rawBody ?? JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  return handleEndpoints({ config: payload.config, request })
}

export async function readRpc(res: Response): Promise<{ result?: any; error?: any }> {
  const text = await res.text()
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean)
    return JSON.parse(data[data.length - 1])
  }
  return text ? JSON.parse(text) : {}
}

export async function rpc(payload: Payload, method: string, params: Record<string, unknown> = {}, init: RpcInit = {}) {
  return readRpc(await mcpRequest(payload, method, params, init))
}

export const callTool = (payload: Payload, name: string, args: Record<string, unknown> = {}, init: RpcInit = {}) =>
  rpc(payload, 'tools/call', { name, arguments: args }, init)

/** Parsed JSON payload of a successful tool call. */
export const toolJson = (body: { result?: { content?: { text: string }[]; isError?: boolean } }) => {
  if (!body.result || body.result.isError) throw new Error(`tool call failed: ${JSON.stringify(body)}`)
  return JSON.parse(body.result.content![0].text)
}

/** A call the server refused: JSON-RPC error or an isError tool result. */
export const isRejected = (body: { result?: { isError?: boolean }; error?: unknown }) => Boolean(body.error) || body.result?.isError === true
