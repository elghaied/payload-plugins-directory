import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createPayloadRequest, type Payload } from 'payload'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
import { githubSessionStrategy } from '@/lib/auth/strategy'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createPlugin, createRepo, trashPlugin } from './helpers/directory'

/**
 * Documents the Payload 4.0.0-beta.x behaviours the app works around (re-verified on 4.0.0-beta.3).
 * If one of these fails after an upgrade, the matching workaround may be removable or must be revisited.
 */
let payload: Payload
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('(a) populate + _h_slugPath select', () => {
  it('truncates the parent segment of the path when `populate` selects only the category slug', async () => {
    const parent = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Storage', slug: 'storage' } })
    const child = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Cloud', slug: 'cloud', parent: parent.id } })
    const repo = await createRepo(payload)
    const plugin = await createPlugin(payload, repo.id, { category: child.id })
    const read = (sel: Record<string, true>) =>
      payload.find({
        collection: 'plugins', where: { id: { equals: plugin.id } }, overrideAccess: true, depth: 1,
        context: { computeHierarchyPaths: true }, select: { category: true }, populate: { categories: sel },
      }).then((r) => r.docs[0].category as unknown)
    // Documented bugs (the real path is 'storage/cloud'; the workaround is to omit `populate`, see queries.ts):
    // naming _h_slugPath in populate leaves the relation as a bare id ...
    expect(await read({ slug: true, _h_slugPath: true })).toBe(child.id)
    // ... and without it the computed path is truncated to the category's own slug (the parent is not selected).
    expect(await read({ slug: true })).toMatchObject({ slug: 'cloud', _h_slugPath: 'cloud' })
    const unrestricted = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 1, context: { computeHierarchyPaths: true } })
    expect((unrestricted.category as { _h_slugPath?: string })._h_slugPath).toBe('storage/cloud')
  })
})

describe('(b) createPayloadRequest context', () => {
  it('merges the context onto req.context and uses the caller object directly (no copy)', async () => {
    const ctx: Record<string, unknown> = { a: 1 }
    const req = await createPayloadRequest({ payload, context: ctx })
    expect(req.context).toMatchObject({ a: 1 })
    expect(req.context).toBe(ctx)
    ctx.later = true
    expect((req.context as Record<string, unknown>).later).toBe(true)
  })
})

describe('(c) custom auth strategies run before the built-in JWT strategy', () => {
  it('the raw github-session strategy wins over a valid admin payload-token; the registered wrapper defers to the admin', async () => {
    const maker = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 9001, login: 'ordering' } })
    const session = await signSessionToken({ maintainerId: maker.id, githubId: 9001 }, getSessionSecret())
    await payload.create({ collection: 'users', overrideAccess: true, data: { email: 'order@example.com', password: 'correct-horse-battery-1' } })
    const adminToken = (await payload.login({ collection: 'users', data: { email: 'order@example.com', password: 'correct-horse-battery-1' } })).token as string
    const headers = new Headers({ cookie: `payload-token=${adminToken}; ${SESSION_COOKIE}=${session}`, 'sec-fetch-site': 'same-origin' })

    expect((await payload.auth({ headers })).user?.collection).toBe('users') // registered (deferring) strategy
    // Swap the wrapper for the raw strategy in the ordered list Payload actually iterates.
    const original = payload.authStrategies
    expect(original.map((x) => x.name)).toContain('github-session')
    payload.authStrategies = original.map((x) => (x.name === 'github-session' ? { name: 'github-session', authenticate: githubSessionStrategy.authenticate } : x))
    try {
      // If custom strategies ran after JWT the admin would still win here.
      expect((await payload.auth({ headers })).user?.collection).toBe('maintainers')
    } finally {
      payload.authStrategies = original
    }
    expect((await payload.auth({ headers })).user?.collection).toBe('users')
  })
})

describe('(d) payload.delete hard-deletes; trash is deletedAt', () => {
  it('delete removes the row permanently, deletedAt keeps it readable with trash: true', async () => {
    const repo = await createRepo(payload)
    const gone = await createPlugin(payload, repo.id)
    await payload.delete({ collection: 'plugins', id: gone.id, overrideAccess: true })
    const afterDelete = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { id: { equals: gone.id } } })
    expect(afterDelete.docs).toHaveLength(0)

    const trashed = await createPlugin(payload, (await createRepo(payload)).id)
    await trashPlugin(payload, trashed.id)
    expect((await payload.find({ collection: 'plugins', overrideAccess: true, where: { id: { equals: trashed.id } } })).docs).toHaveLength(0)
    const inTrash = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { id: { equals: trashed.id } } })
    expect(inTrash.docs).toHaveLength(1)
  })
})

describe('(e) _h_slugPath is virtual', () => {
  it('is absent unless selected or context.computeHierarchyPaths is set', async () => {
    const cat = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'Virt', slug: 'virt' } })
    const plain = await payload.findByID({ collection: 'categories', id: cat.id, overrideAccess: true })
    expect(plain._h_slugPath).toBeUndefined()
    const selected = await payload.findByID({ collection: 'categories', id: cat.id, overrideAccess: true, select: { slug: true, _h_slugPath: true } })
    expect(selected._h_slugPath).toBe('virt')
    const ctx = await payload.findByID({ collection: 'categories', id: cat.id, overrideAccess: true, context: { computeHierarchyPaths: true } })
    expect(ctx._h_slugPath).toBe('virt')
  })
})
