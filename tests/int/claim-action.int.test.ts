import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { MESSAGES } from '@/lib/submissions/messages'
import { getTestPayload, resetDatabase } from './helpers/payload'

const holder = vi.hoisted(() => ({ payload: undefined as unknown, maintainer: null as unknown }))
vi.mock('payload', async (importOriginal) => {
  const original = await importOriginal<typeof import('payload')>()
  return { ...original, getPayload: (args: never) => (holder.payload ? Promise.resolve(holder.payload) : original.getPayload(args)) }
})
vi.mock('@/lib/auth/current', () => ({ getCurrentMaintainer: async () => holder.maintainer }))
// The action builds its own GitHub client: a fetch that always fails stands in for the unauthenticated, rate-limited web service.
vi.mock('@/lib/github/client', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/github/client')>()
  return { ...original, createGitHubAuthClient: () => original.createGitHubAuthClient({ fetch: async () => new Response('rate limited', { status: 403 }), token: undefined }) }
})

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
  maker = { ...(await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 61, login: 'claimer' } })), collection: 'maintainers' }
  const repo = await payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName: 'a/b', owner: 'a', githubId: 6001, url: 'https://github.com/a/b' } })
  await payload.create({ collection: 'plugins', overrideAccess: true, data: { slug: 'ab', name: 'ab', repository: repo.id, url: repo.url, source: 'topic', visibility: 'listed' } })
})
afterAll(async () => resetDatabase(payload))

describe('claimPluginAction', () => {
  it('returns signed_out without a maintainer and writes nothing', async () => {
    const { claimPluginAction } = await import('@/app/(site)/claim/[slug]/actions')
    holder.maintainer = null
    expect(await claimPluginAction({ status: 'idle' }, form({ slug: 'ab' }))).toEqual({ status: 'signed_out' })
    expect((await payload.count({ collection: 'submissions', overrideAccess: true })).totalDocs).toBe(0)
  })
  it('queues (never grants, never errors) when GitHub answers 403 to the unauthenticated client', async () => {
    const { claimPluginAction } = await import('@/app/(site)/claim/[slug]/actions')
    holder.maintainer = maker
    expect(await claimPluginAction({ status: 'idle' }, form({ slug: 'ab', note: 'x' }))).toEqual({ status: 'queued' })
    const plugin = (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, where: { slug: { equals: 'ab' } } })).docs[0]
    expect(plugin.maintainers ?? []).toEqual([])
  })
  it('treats a non-string slug as unknown', async () => {
    const { claimPluginAction } = await import('@/app/(site)/claim/[slug]/actions')
    holder.maintainer = maker
    expect(await claimPluginAction({ status: 'idle' }, form({ slug: new File(['ab'], 'x.txt') }))).toEqual({ status: 'not_found' })
  })
  it('maps an unexpected failure to a generic message', async () => {
    const { claimPluginAction } = await import('@/app/(site)/claim/[slug]/actions')
    holder.maintainer = { ...maker, id: 999999 }
    const err = vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined)
    try {
      const res = await claimPluginAction({ status: 'idle' }, form({ slug: 'ab' }))
      expect(res).toEqual({ status: 'invalid', message: MESSAGES.submitFailed })
      expect(err).toHaveBeenCalled()
    } finally {
      err.mockRestore()
    }
  })
})
