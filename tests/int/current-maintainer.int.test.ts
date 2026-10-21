import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { getTestPayload, resetDatabase } from './helpers/payload'

const holder = vi.hoisted(() => ({ payload: undefined as unknown, headers: new Headers() }))
vi.mock('next/headers', () => ({ headers: async () => holder.headers }))
vi.mock('payload', async (importOriginal) => {
  const original = await importOriginal<typeof import('payload')>()
  return { ...original, getPayload: (args: never) => (holder.payload ? Promise.resolve(holder.payload) : original.getPayload(args)) }
})

let payload: Payload
let sessionToken: string
let adminToken: string

beforeAll(async () => {
  payload = await getTestPayload()
  holder.payload = payload
  await resetDatabase(payload)
  const maker = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 777, login: 'both' } })
  sessionToken = await signSessionToken({ maintainerId: maker.id, githubId: 777 }, getSessionSecret())
  await payload.create({ collection: 'users', overrideAccess: true, data: { email: 'admin@example.com', password: 'correct-horse-battery-1' } })
  const login = await payload.login({ collection: 'users', data: { email: 'admin@example.com', password: 'correct-horse-battery-1' } })
  adminToken = login.token as string
})
afterAll(async () => resetDatabase(payload))

describe('getCurrentMaintainer', () => {
  it('resolves the maintainer when a valid admin payload-token cookie is also present', async () => {
    holder.headers = new Headers({ cookie: `payload-token=${adminToken}; ${SESSION_COOKIE}=${sessionToken}` })
    // Sanity: Payload's own resolution returns the admin first, which is what hid the maintainer.
    expect((await payload.auth({ headers: holder.headers })).user?.collection).toBe('users')
    const { getCurrentMaintainer, requireMaintainer } = await import('@/lib/auth/current')
    expect(await getCurrentMaintainer()).toMatchObject({ login: 'both', collection: 'maintainers' })
    // /me, /submit and /claim all go through requireMaintainer: no redirect to GitHub.
    for (const path of ['/me', '/submit', '/claim/ab']) {
      await expect(requireMaintainer(path)).resolves.toMatchObject({ login: 'both' })
    }
  })
  it('is null without the maintainer cookie, and ignores a cross-origin server action', async () => {
    const { getCurrentMaintainer } = await import('@/lib/auth/current')
    holder.headers = new Headers({ cookie: `payload-token=${adminToken}` })
    expect(await getCurrentMaintainer()).toBeNull()
    holder.headers = new Headers({ cookie: `${SESSION_COOKIE}=${sessionToken}`, origin: 'https://evil.example', 'next-action': 'abc' })
    expect(await getCurrentMaintainer()).toBeNull()
  })
})
