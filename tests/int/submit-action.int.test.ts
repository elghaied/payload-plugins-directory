import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { getTestPayload, resetDatabase } from './helpers/payload'

// The action's `getPayload` is redirected to the shared test Payload (the real config is only evaluated after getTestPayload() set the test DB).
const holder = vi.hoisted(() => ({ payload: undefined as unknown, maintainer: null as unknown }))
vi.mock('payload', async (importOriginal) => {
  const original = await importOriginal<typeof import('payload')>()
  return { ...original, getPayload: (args: never) => (holder.payload ? Promise.resolve(holder.payload) : original.getPayload(args)) }
})
vi.mock('@/lib/auth/current', () => ({ getCurrentMaintainer: async () => holder.maintainer }))

let payload: Payload
let maker: CurrentMaintainer

const form = (entries: Record<string, string | Blob>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

beforeAll(async () => {
  payload = await getTestPayload()
  holder.payload = payload
  await resetDatabase(payload)
  maker = { ...(await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 31, login: 'action-user' } })), collection: 'maintainers' }
})
afterAll(async () => resetDatabase(payload))

describe('submitListingAction', () => {
  it('returns signed_out without a maintainer', async () => {
    const { submitListingAction } = await import('@/app/(site)/submit/actions')
    holder.maintainer = null
    expect(await submitListingAction({ status: 'idle' }, form({ url: 'https://github.com/a/b' }))).toEqual({ status: 'signed_out' })
    expect((await payload.count({ collection: 'submissions', overrideAccess: true })).totalDocs).toBe(0)
  })
  it('creates a submission for the signed-in maintainer', async () => {
    const { submitListingAction } = await import('@/app/(site)/submit/actions')
    holder.maintainer = maker
    expect(await submitListingAction({ status: 'idle' }, form({ url: 'https://github.com/a/b', note: 'hi' }))).toEqual({ status: 'created' })
  })
  it('posts kind=template as a template listing; any other kind value is a plugin listing', async () => {
    const { submitListingAction } = await import('@/app/(site)/submit/actions')
    holder.maintainer = maker
    expect(await submitListingAction({ status: 'idle' }, form({ url: 'https://github.com/a/tpl/tree/main/site', kind: 'template' }))).toEqual({ status: 'created' })
    expect(await submitListingAction({ status: 'idle' }, form({ url: 'https://github.com/a/other', kind: 'templates' }))).toEqual({ status: 'created' })
    const docs = (await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, sort: 'id' })).docs
    expect(docs.map((d) => [d.url, d.kind, d.path ?? null])).toEqual(
      expect.arrayContaining([
        ['https://github.com/a/tpl/tree/HEAD/site', 'template', 'site'],
        ['https://github.com/a/other', 'plugin', null],
      ]),
    )
  })
  it('treats a non-string (File) value as empty and reports an invalid URL', async () => {
    const { submitListingAction } = await import('@/app/(site)/submit/actions')
    holder.maintainer = maker
    const res = await submitListingAction({ status: 'idle' }, form({ url: new File(['https://github.com/a/c'], 'x.txt') }))
    expect(res).toMatchObject({ status: 'invalid' })
  })
  it('maps an unexpected failure to a generic message', async () => {
    const { submitListingAction } = await import('@/app/(site)/submit/actions')
    holder.maintainer = { ...maker, id: 999999 } // submittedBy is stamped from the user; a missing row makes the insert fail
    const err = vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined)
    try {
      const res = await submitListingAction({ status: 'idle' }, form({ url: 'https://github.com/a/d' }))
      expect(res).toMatchObject({ status: 'invalid' })
      expect(err).toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })
})
