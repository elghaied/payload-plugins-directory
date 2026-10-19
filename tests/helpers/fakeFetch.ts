import type { FetchFn } from '@/sync/http'

export type FakeResponse = { status?: number; json?: unknown; text?: string; headers?: Record<string, string> }
export type FakeRoute = FakeResponse | ((init?: RequestInit) => FakeResponse)
export type FakeCall = { url: string; init?: RequestInit }
export type FakeFetch = FetchFn & { calls: FakeCall[] }

/**
 * Deterministic stand-in for fetch, routed by exact URL. An unknown URL rejects, so a test can never
 * reach the network by accident, unless it starts with one of `notFoundPrefixes` (answered with 404).
 */
export function fakeFetch(
  routes: Record<string, FakeRoute> = {},
  opts: { notFoundPrefixes?: string[] } = {},
): FakeFetch {
  const calls: FakeCall[] = []
  const fn = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, init })
    const route = Object.hasOwn(routes, url) ? routes[url] : undefined
    if (!route) {
      if (opts.notFoundPrefixes?.some((prefix) => url.startsWith(prefix))) return new Response('', { status: 404 })
      throw new Error(`fakeFetch: unexpected request ${url}`)
    }
    const r = typeof route === 'function' ? route(init) : route
    const body = r.text ?? (r.json === undefined ? '' : JSON.stringify(r.json))
    return new Response(body, { status: r.status ?? 200, headers: r.headers })
  }
  return Object.assign(fn, { calls })
}
