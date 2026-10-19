import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import type { Maintainer } from '@/payload-types'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { githubSessionStrategy, isCrossOriginWrite, revokeSessionsNow } from '@/lib/auth/strategy'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
let m: Maintainer
const DAY = 24 * 60 * 60 * 1000
const cookie = (token: string) => new Headers({ cookie: `other=1; ${SESSION_COOKIE}=${token}` })
const tokenFor = (id: number, githubId: number, now?: Date) => signSessionToken({ maintainerId: id, githubId }, getSessionSecret(), now)

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 4242, login: 'octo' } })
})
afterAll(async () => resetDatabase(payload))

describe('github-session strategy', () => {
  it('authenticates a valid cookie as the maintainer (payload.auth)', async () => {
    const token = await tokenFor(m.id, 4242)
    const { user } = await payload.auth({ headers: cookie(token) })
    expect(user).toMatchObject({ id: m.id, collection: 'maintainers', login: 'octo', _strategy: 'github-session' })
  })
  it('does not expose moderation fields on the request user', async () => {
    const { user } = await payload.auth({ headers: cookie(await tokenFor(m.id, 4242)) })
    expect(user).not.toHaveProperty('blocked')
    expect(user).not.toHaveProperty('sessionsValidAfter')
  })
  it('ignores requests without the cookie', async () => {
    const { user } = await payload.auth({ headers: new Headers() })
    expect(user).toBeNull()
  })
  it('rejects a token signed with another secret', async () => {
    const token = await signSessionToken({ maintainerId: m.id, githubId: 4242 }, getSessionSecret({ SESSION_SECRET: 'z'.repeat(40) }))
    expect((await payload.auth({ headers: cookie(token) })).user).toBeNull()
  })
  it('rejects an expired token', async () => {
    const token = await tokenFor(m.id, 4242, new Date(Date.now() - 31 * DAY))
    expect((await payload.auth({ headers: cookie(token) })).user).toBeNull()
  })
  it('rejects a token whose githubId does not match the maintainer', async () => {
    expect((await payload.auth({ headers: cookie(await tokenFor(m.id, 9999)) })).user).toBeNull()
  })
  it('rejects a token for a maintainer that no longer exists', async () => {
    expect((await payload.auth({ headers: cookie(await tokenFor(987654, 4242)) })).user).toBeNull()
  })
  it('ignores the cookie on a cross-origin unsafe request', async () => {
    const token = await tokenFor(m.id, 4242)
    const headers = new Headers({ cookie: `${SESSION_COOKIE}=${token}`, origin: 'https://evil.example' })
    const result = await githubSessionStrategy.authenticate({ headers, payload, req: { method: 'PATCH' } as never })
    expect(result.user).toBeNull()
  })
  it('fails closed when SESSION_SECRET is missing', async () => {
    const token = await tokenFor(m.id, 4242)
    const saved = process.env.SESSION_SECRET
    process.env.SESSION_SECRET = ''
    try {
      expect((await payload.auth({ headers: cookie(token) })).user).toBeNull()
    } finally {
      process.env.SESSION_SECRET = saved
    }
  })
})

describe('github-session strategy: revocation (blocked, sessionsValidAfter)', () => {
  let r: Maintainer
  beforeAll(async () => {
    r = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 5151, login: 'revocable' } })
  })
  beforeEach(() => set({ blocked: false, sessionsValidAfter: null }))
  const set = (data: Partial<Maintainer>) => payload.update({ collection: 'maintainers', id: r.id, overrideAccess: true, data })

  it('rejects a blocked maintainer, and accepts again when unblocked', async () => {
    const token = await tokenFor(r.id, 5151)
    expect((await payload.auth({ headers: cookie(token) })).user).not.toBeNull()
    await set({ blocked: true })
    expect((await payload.auth({ headers: cookie(token) })).user).toBeNull()
    await set({ blocked: false })
    expect((await payload.auth({ headers: cookie(token) })).user).not.toBeNull()
  })
  it('rejects a token issued before sessionsValidAfter, accepts one issued after it', async () => {
    const old = await tokenFor(r.id, 5151, new Date(Date.now() - 60_000))
    await set({ sessionsValidAfter: new Date(Date.now() - 30_000).toISOString() })
    expect((await payload.auth({ headers: cookie(old) })).user).toBeNull()
    expect((await payload.auth({ headers: cookie(await tokenFor(r.id, 5151)) })).user).not.toBeNull()
  })
  it('revokeSessionsNow rejects a token minted in the same second, accepts one from the next second', async () => {
    const now = new Date()
    const sameSecond = await tokenFor(r.id, 5151, now)
    await set({ sessionsValidAfter: revokeSessionsNow(now).toISOString() })
    expect((await payload.auth({ headers: cookie(sameSecond) })).user).toBeNull()
    const nextSecond = await tokenFor(r.id, 5151, revokeSessionsNow(now))
    expect((await payload.auth({ headers: cookie(nextSecond) })).user).not.toBeNull()
  })
  it('a fractional-second cutoff rounds up: a token from the cutoff second is rejected', async () => {
    const cutoff = new Date(1_800_000_000_500)
    await set({ sessionsValidAfter: cutoff.toISOString() })
    const sameSecond = await tokenFor(r.id, 5151, new Date(1_800_000_000_000))
    expect((await payload.auth({ headers: cookie(sameSecond) })).user).toBeNull()
  })
  it('revokeSessionsNow is strictly in the next whole second', () => {
    expect(revokeSessionsNow(new Date(1_800_000_000_000)).getTime()).toBe(1_800_000_001_000)
    expect(revokeSessionsNow(new Date(1_800_000_000_999)).getTime()).toBe(1_800_000_001_000)
  })
})

describe('isCrossOriginWrite', () => {
  const site = 'https://payloaddirectory.dev'
  it.each([
    ['GET', 'https://evil.example', false],
    ['POST', null, false],
    ['POST', site, false],
    ['POST', 'https://evil.example', true],
    ['DELETE', 'null', true],
    [undefined, 'https://evil.example', false],
  ] as const)('%s from %s -> %s', (method, origin, expected) => {
    expect(isCrossOriginWrite(method, origin, site)).toBe(expected)
  })
  it('skips the check when no server URL is configured (local dev)', () => {
    expect(isCrossOriginWrite('POST', 'https://evil.example', '')).toBe(false)
  })
})
