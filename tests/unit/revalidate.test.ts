import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }))

import { revalidateTag } from 'next/cache'
import { POST } from '@/app/api/revalidate/route'
import { isAuthorizedRevalidation, MAX_TAGS, parseRevalidateBody } from '@/lib/revalidate'
import { postRevalidate } from '@/sync/revalidate'
import { fakeFetch } from '../helpers/fakeFetch'

const SECRET = 'test-secret-0123456789-abcdefghijklmnop' // >= 32 chars

describe('isAuthorizedRevalidation', () => {
  it('accepts only the exact bearer secret', () => {
    expect(isAuthorizedRevalidation(`Bearer ${SECRET}`, SECRET)).toBe(true)
    expect(isAuthorizedRevalidation(`Bearer ${SECRET}-x`, SECRET)).toBe(false)
    expect(isAuthorizedRevalidation(`Bearer ${SECRET.slice(1)}`, SECRET)).toBe(false)
    expect(isAuthorizedRevalidation(SECRET, SECRET)).toBe(false)
    expect(isAuthorizedRevalidation(null, SECRET)).toBe(false)
  })
  it('never authorizes with an empty or too-short secret', () => {
    expect(isAuthorizedRevalidation('Bearer ', '')).toBe(false)
    expect(isAuthorizedRevalidation('Bearer short', 'short')).toBe(false)
  })
})

describe('parseRevalidateBody', () => {
  it('dedupes valid tags', () => {
    expect(parseRevalidateBody({ tags: ['plugins', 'plugin:a', 'plugins'] })).toEqual({ ok: true, tags: ['plugins', 'plugin:a'] })
  })
  it('rejects empty, oversized and malformed lists', () => {
    expect(parseRevalidateBody({ tags: [] }).ok).toBe(false)
    expect(parseRevalidateBody(null).ok).toBe(false)
    expect(parseRevalidateBody({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `plugin:p${i}`) }).ok).toBe(false)
    expect(parseRevalidateBody({ tags: ['plugins', 'user:1'] })).toEqual({ ok: false, error: 'invalid tag: user:1' })
    expect(parseRevalidateBody({ tags: [42] }).ok).toBe(false)
    expect(parseRevalidateBody({ tags: [`plugin:${'a'.repeat(300)}`] }).ok).toBe(false)
  })
})

describe('POST /api/revalidate', () => {
  const call = (body: unknown, auth?: string) =>
    POST(
      new Request('http://localhost:3000/api/revalidate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    )

  beforeEach(() => {
    vi.mocked(revalidateTag).mockClear()
    process.env.REVALIDATE_SECRET = SECRET
  })
  afterAll(() => {
    delete process.env.REVALIDATE_SECRET
  })

  it('refuses (503) when REVALIDATE_SECRET is unset, even with an empty bearer', async () => {
    delete process.env.REVALIDATE_SECRET
    expect((await call({ tags: ['plugins'] }, 'Bearer ')).status).toBe(503)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
  it('refuses (503) when REVALIDATE_SECRET is shorter than 32 characters, even with the matching bearer', async () => {
    process.env.REVALIDATE_SECRET = 'short'
    expect((await call({ tags: ['plugins'] }, 'Bearer short')).status).toBe(503)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
  it('rejects a wrong or missing secret with 401 and revalidates nothing', async () => {
    expect((await call({ tags: ['plugins'] }, 'Bearer nope')).status).toBe(401)
    expect((await call({ tags: ['plugins'] })).status).toBe(401)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
  it('rejects bad JSON, invalid tags and oversized lists with 400', async () => {
    const auth = `Bearer ${SECRET}`
    expect((await call('{not json', auth)).status).toBe(400)
    expect((await call({ tags: ['user:1'] }, auth)).status).toBe(400)
    expect((await call({ tags: Array.from({ length: MAX_TAGS + 1 }, (_, i) => `plugin:p${i}`) }, auth)).status).toBe(400)
    expect(revalidateTag).not.toHaveBeenCalled()
  })
  it('never echoes the secret', async () => {
    const res = await call({ tags: ['user:1'] }, `Bearer ${SECRET}`)
    expect(await res.text()).not.toContain(SECRET)
  })
  it('revalidates each tag with the max profile', async () => {
    const res = await call({ tags: ['plugins', 'plugin:a'] }, `Bearer ${SECRET}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revalidated: ['plugins', 'plugin:a'] })
    expect(vi.mocked(revalidateTag).mock.calls).toEqual([['plugins', 'max'], ['plugin:a', 'max']])
  })
})

describe('postRevalidate', () => {
  const url = 'http://web.test/api/revalidate'

  it('posts deduped tags in chunks with the bearer secret', async () => {
    const f = fakeFetch({ [url]: { json: { revalidated: [] } } })
    const tags = [...Array.from({ length: MAX_TAGS + 1 }, (_, i) => `plugin:p${i}`), 'plugin:p0']
    expect(await postRevalidate(tags, { fetch: f, url, secret: SECRET })).toBe(MAX_TAGS + 1)
    expect(f.calls).toHaveLength(2)
    expect(new Headers(f.calls[0].init?.headers).get('authorization')).toBe(`Bearer ${SECRET}`)
    expect(JSON.parse(String(f.calls[1].init?.body))).toEqual({ tags: [`plugin:p${MAX_TAGS}`] })
  })
  it('drops and reports invalid tags instead of failing the whole batch', async () => {
    const f = fakeFetch({ [url]: { json: { revalidated: [] } } })
    const dropped: string[][] = []
    const count = await postRevalidate(['plugins', 'plugin:7-has space', 'plugin:ok', 'bogus'], {
      fetch: f, url, secret: SECRET, onInvalid: (tags) => dropped.push(tags),
    })
    expect(count).toBe(2)
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ tags: ['plugins', 'plugin:ok'] })
    expect(dropped).toEqual([['plugin:7-has space', 'bogus']])
    const idle = fakeFetch()
    expect(await postRevalidate(['bogus'], { fetch: idle, url, secret: SECRET })).toBe(0)
    expect(idle.calls).toHaveLength(0)
  })
  it('throws on a non-2xx answer without leaking the secret, and sends nothing for an empty list', async () => {
    const err = await postRevalidate(['plugins'], { fetch: fakeFetch({ [url]: { status: 401 } }), url, secret: SECRET }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/HTTP 401/)
    expect((err as Error).message).not.toContain(SECRET)
    const idle = fakeFetch()
    expect(await postRevalidate([], { fetch: idle, url, secret: SECRET })).toBe(0)
    expect(idle.calls).toHaveLength(0)
  })
})
