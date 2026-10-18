import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const admin = { id: 1, collection: 'users' } as const
const maintainer = { id: 1, collection: 'maintainers' } as const

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = await payload.create({
    collection: 'repositories',
    overrideAccess: true,
    data: { fullName: 'acme/plugin', owner: 'acme', url: 'https://github.com/acme/plugin' },
  })
  for (const [slug, visibility] of [['listed-one', 'listed'], ['hidden-one', 'hidden'], ['trashed-one', 'listed']] as const) {
    await payload.create({
      collection: 'plugins',
      overrideAccess: true,
      data: { slug, name: slug, repository: repo.id, url: 'https://github.com/acme/plugin', visibility, source: 'topic' },
    })
  }
  const trashed = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: 'trashed-one' } } })
  await payload.delete({ collection: 'plugins', id: trashed.docs[0].id, overrideAccess: true })
  await payload.create({
    collection: 'maintainers',
    overrideAccess: true,
    data: { githubId: 42, login: 'octo' },
  })
})
afterAll(async () => resetDatabase(payload))

const slugs = (docs: { slug: string }[]) => docs.map((d) => d.slug).sort()

describe('access matrix', () => {
  it('anonymous sees only listed, non-trashed plugins', async () => {
    const res = await payload.find({ collection: 'plugins', overrideAccess: false, user: null })
    expect(slugs(res.docs)).toEqual(['listed-one'])
  })
  it('admin sees listed and hidden plugins', async () => {
    const res = await payload.find({ collection: 'plugins', overrideAccess: false, user: admin as never })
    expect(slugs(res.docs)).toEqual(['hidden-one', 'listed-one'])
  })
  it('anonymous cannot create plugins', async () => {
    await expect(
      payload.create({ collection: 'plugins', overrideAccess: false, user: null, data: { slug: 'x', name: 'x', repository: 1, url: 'u', source: 'topic', visibility: 'listed' } }),
    ).rejects.toThrow()
  })
  it('anonymous cannot read maintainers, users, or submissions', async () => {
    for (const collection of ['maintainers', 'users', 'submissions'] as const) {
      await expect(payload.find({ collection, overrideAccess: false, user: null })).rejects.toThrow()
    }
  })
  it('maintainer cannot update plugins', async () => {
    const listed = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: 'listed-one' } } })
    await expect(
      payload.update({ collection: 'plugins', id: listed.docs[0].id, overrideAccess: false, user: maintainer as never, data: { name: 'pwned' } }),
    ).rejects.toThrow()
  })
  it('anonymous can read repositories, categories, tags', async () => {
    for (const collection of ['repositories', 'categories', 'tags'] as const) {
      await expect(payload.find({ collection, overrideAccess: false, user: null })).resolves.toBeDefined()
    }
  })
  it('anonymous cannot read the ai settings group', async () => {
    const settings = await payload.findGlobal({ slug: 'directory-settings', overrideAccess: false, user: null })
    expect(settings.ai).toBeUndefined()
  })
  it('an admin can still log in despite admin-only users read access', async () => {
    const email = 'admin@example.com'
    const password = 'correct-horse-battery-staple'
    await payload.create({ collection: 'users', overrideAccess: true, data: { email, password } })
    const result = await payload.login({ collection: 'users', data: { email, password }, overrideAccess: false })
    expect(result.token).toEqual(expect.any(String))
  })
})
