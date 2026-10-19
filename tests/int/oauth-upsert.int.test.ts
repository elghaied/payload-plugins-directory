import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { revokeMaintainerSessions, upsertMaintainer } from '@/lib/auth/maintainers'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

const all = () => payload.find({ collection: 'maintainers', overrideAccess: true, limit: 50 })

describe('upsertMaintainer', () => {
  it('creates on first sign-in and updates identity on the next, keyed by githubId', async () => {
    const first = await upsertMaintainer(payload, { id: 555, login: 'octo', name: 'Octo', avatarUrl: null })
    const second = await upsertMaintainer(payload, {
      id: 555, login: 'octo-renamed', name: null, avatarUrl: 'https://avatars.githubusercontent.com/u/555',
    })
    expect(second.id).toBe(first.id)
    const docs = (await all()).docs.filter((d) => d.githubId === 555)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ githubId: 555, login: 'octo-renamed', avatarUrl: 'https://avatars.githubusercontent.com/u/555' })
  })

  it('never matches by login: a different id with a reused login is a different maintainer', async () => {
    const a = await upsertMaintainer(payload, { id: 601, login: 'same', name: null, avatarUrl: null })
    const b = await upsertMaintainer(payload, { id: 602, login: 'same', name: null, avatarUrl: null })
    expect(b.id).not.toBe(a.id)
  })

  it('clamps over-long identity values', async () => {
    const m = await upsertMaintainer(payload, { id: 603, login: 'l'.repeat(300), name: 'n'.repeat(900), avatarUrl: null })
    expect(m.login).toHaveLength(100)
    expect(m.name).toHaveLength(200)
  })

  it('returns a blocked maintainer untouched and does not duplicate them', async () => {
    const m = await upsertMaintainer(payload, { id: 700, login: 'bad', name: null, avatarUrl: null })
    await payload.update({ collection: 'maintainers', id: m.id, data: { blocked: true }, overrideAccess: true })
    const again = await upsertMaintainer(payload, { id: 700, login: 'bad-renamed', name: 'X', avatarUrl: null })
    expect(again.id).toBe(m.id)
    expect(again.blocked).toBe(true)
    const row = (await all()).docs.filter((d) => d.githubId === 700)
    expect(row).toHaveLength(1)
    expect(row[0].login).toBe('bad')
  })
})

describe('revokeMaintainerSessions', () => {
  it('rejects sessions issued before the revocation, accepts later ones', async () => {
    const m = await upsertMaintainer(payload, { id: 800, login: 'out', name: null, avatarUrl: null })
    const cookie = (t: string) => new Headers({ cookie: `${SESSION_COOKIE}=${t}` })
    const old = await signSessionToken({ maintainerId: m.id, githubId: 800 }, getSessionSecret())
    expect((await payload.auth({ headers: cookie(old) })).user).not.toBeNull()
    await revokeMaintainerSessions(payload, m.id)
    expect((await payload.auth({ headers: cookie(old) })).user).toBeNull()
    const later = await signSessionToken({ maintainerId: m.id, githubId: 800 }, getSessionSecret(), new Date(Date.now() + 5000))
    expect((await payload.auth({ headers: cookie(later) })).user).not.toBeNull()
  })
})
