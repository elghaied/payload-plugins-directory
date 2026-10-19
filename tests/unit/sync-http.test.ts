import { describe, expect, it } from 'vitest'
import { getSyncDeps, setSyncDeps } from '@/sync/deps'
import { HttpError, RateLimitError, rateLimitResetAt, withTimeout, type FetchFn } from '@/sync/http'
import { fakeFetch } from '../helpers/fakeFetch'

const now = new Date('2026-10-19T12:00:00Z')
const res = (status: number, headers: Record<string, string> = {}) => new Response('', { status, headers })

describe('rateLimitResetAt', () => {
  it('reads x-ratelimit-reset when the quota is exhausted', () => {
    const r = res(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1792411200' })
    expect(rateLimitResetAt(r, now)).toEqual(new Date(1792411200 * 1000))
  })
  it('prefers retry-after (GitHub secondary limits, npm)', () => {
    expect(rateLimitResetAt(res(403, { 'retry-after': '60' }), now)).toEqual(new Date('2026-10-19T12:01:00Z'))
  })
  it('defaults a bare 429 to one minute', () => {
    expect(rateLimitResetAt(res(429), now)).toEqual(new Date('2026-10-19T12:01:00Z'))
  })
  it('is null for a plain 403, a 404 and a success', () => {
    expect(rateLimitResetAt(res(403), now)).toBeNull()
    expect(rateLimitResetAt(res(404), now)).toBeNull()
    expect(rateLimitResetAt(res(200, { 'x-ratelimit-remaining': '0' }), now)).toBeNull()
  })
})

describe('errors', () => {
  it('RateLimitError carries the reset time and an optional re-queue input', () => {
    const err = new RateLimitError('npm', now).withRequeueInput({ slugs: ['a'] })
    expect(err).toBeInstanceOf(RateLimitError)
    expect(err.resetAt).toEqual(now)
    expect(err.requeueInput).toEqual({ slugs: ['a'] })
    expect(err.message).toContain('npm rate limit')
  })
  it('HttpError names status and url', () => {
    expect(new HttpError(502, 'https://x.test').message).toBe('HTTP 502 for https://x.test')
  })
})

describe('fakeFetch', () => {
  it('serves registered routes and records calls', async () => {
    const f = fakeFetch({ 'https://a.test/x': { json: { ok: 1 }, headers: { 'x-h': '1' } } })
    const r = await f('https://a.test/x')
    expect(await r.json()).toEqual({ ok: 1 })
    expect(r.headers.get('x-h')).toBe('1')
    expect(f.calls.map((c) => c.url)).toEqual(['https://a.test/x'])
  })
  it('rejects unregistered URLs', async () => {
    await expect(fakeFetch()('https://a.test/y')).rejects.toThrow(/unexpected request/)
  })
  it('answers 404 under notFoundPrefixes', async () => {
    const f = fakeFetch({}, { notFoundPrefixes: ['https://raw.test/'] })
    expect((await f('https://raw.test/a')).status).toBe(404)
  })
})

describe('global network guard', () => {
  it('blocks the real fetch in tests', async () => {
    await expect(fetch('https://example.com')).rejects.toThrow(/Network access is disabled/)
  })
})

describe('withTimeout', () => {
  const hangs: FetchFn = (_url, init) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))

  it('rejects a request that outlives the deadline with a TimeoutError', async () => {
    const err = await withTimeout(hangs, 10)('https://example.test/').catch((e: unknown) => e)
    expect((err as Error).name).toBe('TimeoutError')
  })
  it('keeps the caller signal working alongside the deadline', async () => {
    const ctl = new AbortController()
    const pending = withTimeout(hangs, 60_000)('https://example.test/', { signal: ctl.signal }).catch((e: unknown) => e)
    ctl.abort(new Error('caller aborted'))
    expect(((await pending) as Error).message).toBe('caller aborted')
  })
  it('is applied to every sync fetch, overrides included', async () => {
    const f = fakeFetch({ 'https://example.test/': { text: 'ok' } })
    setSyncDeps({ fetch: f })
    try {
      await getSyncDeps().fetch('https://example.test/', { method: 'POST' })
    } finally {
      setSyncDeps(null)
    }
    expect(f.calls[0].init?.signal).toBeInstanceOf(AbortSignal)
    expect(f.calls[0].init?.method).toBe('POST')
  })
})
