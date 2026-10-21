import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Forbidden, ValidationError, type Payload } from 'payload'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
let repoId: number
let listedId: number
let owner: { id: number; collection: 'maintainers' }
let stranger: { id: number; collection: 'maintainers' }
const admin = { id: 1, collection: 'users' } as never

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = await payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName: 'acme/tpl', owner: 'acme', url: 'https://github.com/acme/tpl' } })
  repoId = repo.id
  const a = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 42, login: 'octo' } })
  const b = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 43, login: 'other' } })
  owner = { id: a.id, collection: 'maintainers' }
  stranger = { id: b.id, collection: 'maintainers' }
  for (const [slug, visibility] of [['listed-one', 'listed'], ['hidden-one', 'hidden'], ['trashed-one', 'listed']] as const) {
    const doc = await payload.create({
      collection: 'templates',
      overrideAccess: true,
      data: { slug, name: slug, repository: repoId, url: 'https://github.com/acme/tpl', visibility, source: 'submission', maintainers: slug === 'listed-one' ? [a.id] : [] },
    })
    if (slug === 'listed-one') listedId = doc.id
    if (slug === 'trashed-one') await payload.update({ collection: 'templates', id: doc.id, overrideAccess: true, data: { deletedAt: new Date().toISOString() } })
  }
  await payload.update({ collection: 'templates', id: listedId, overrideAccess: true, data: { readmeHtml: '<p>x</p>' } })
})
afterAll(async () => resetDatabase(payload))

const asUser = (user: unknown) => ({ overrideAccess: false as const, user: user as never })

describe('templates access', () => {
  it('anonymous sees only listed, non-trashed templates', async () => {
    const res = await payload.find({ collection: 'templates', overrideAccess: false, user: null })
    expect(res.docs.map((d) => d.slug)).toEqual(['listed-one'])
  })
  it('anonymous cannot read readmeHtml', async () => {
    const doc = await payload.findByID({ collection: 'templates', id: listedId, overrideAccess: false, user: null, select: { readmeHtml: true } })
    expect(doc).not.toHaveProperty('readmeHtml')
  })
  it('a maintainer of the template may update customTagline', async () => {
    const doc = await payload.update({ collection: 'templates', id: listedId, data: { customTagline: 'Mine' }, ...asUser(owner) })
    expect(doc.customTagline).toBe('Mine')
  })
  it('a maintainer may not update other fields', async () => {
    for (const data of [{ name: 'x' }, { visibility: 'hidden' }, { readme: 'x' }] as const) {
      await expect(payload.update({ collection: 'templates', id: listedId, data: data as never, ...asUser(owner) })).rejects.toThrow(Forbidden)
    }
  })
  it('a maintainer may not update screenshots without the context key', async () => {
    await expect(payload.update({ collection: 'templates', id: listedId, data: { screenshots: [] }, ...asUser(owner) })).rejects.toThrow(Forbidden)
  })
  it('a maintainer may not create or delete', async () => {
    await expect(
      payload.create({ collection: 'templates', data: { slug: 'n', name: 'n', repository: repoId, url: 'u', source: 'submission', visibility: 'listed' }, overrideAccess: false, user: owner as never }),
    ).rejects.toThrow(Forbidden)
    await expect(payload.delete({ collection: 'templates', id: listedId, ...asUser(owner) })).rejects.toThrow(Forbidden)
  })
  it('a non-maintainer may not update', async () => {
    await expect(payload.update({ collection: 'templates', id: listedId, data: { customTagline: 'x' }, ...asUser(stranger) })).rejects.toThrow(Forbidden)
  })
  it('rejects an invalid video URL', async () => {
    await expect(payload.update({ collection: 'templates', id: listedId, data: { videoUrl: 'https://vimeo.com/abc' }, ...asUser(admin) })).rejects.toThrow(ValidationError)
  })
  it('rejects an invalid demo URL and normalizes a valid video URL', async () => {
    await expect(payload.update({ collection: 'templates', id: listedId, data: { demoUrl: 'http://x.example.com' }, ...asUser(admin) })).rejects.toThrow(ValidationError)
    const doc = await payload.update({ collection: 'templates', id: listedId, data: { videoUrl: 'https://youtu.be/dQw4w9WgXcQ' }, ...asUser(admin) })
    expect(doc.videoUrl).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })
  it('an empty demoUrl is stored as null', async () => {
    await payload.update({ collection: 'templates', id: listedId, data: { demoUrl: 'https://demo.example.com' }, overrideAccess: true })
    await payload.update({ collection: 'templates', id: listedId, data: { demoUrl: '' }, overrideAccess: true })
    const stored = await payload.findByID({ collection: 'templates', id: listedId, overrideAccess: true, depth: 0 })
    expect(stored.demoUrl ?? null).toBeNull()
  })
  it('an admin editing ai.summary locks it', async () => {
    const doc = await payload.update({ collection: 'templates', id: listedId, data: { ai: { summary: 'Hand written' } }, ...asUser(admin) })
    expect(doc.locks?.summary).toBe(true)
  })
  it('a maintainer save that changes no owner field queues no revalidate job; a real change queues one', async () => {
    const count = async () => (await payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })).totalDocs
    await payload.update({ collection: 'templates', id: listedId, data: { customTagline: 'Steady' }, ...asUser(owner) })
    const before = await count()
    await payload.update({ collection: 'templates', id: listedId, data: { customTagline: 'Steady' }, ...asUser(owner) })
    expect(await count()).toBe(before)
    await payload.update({ collection: 'templates', id: listedId, data: { customTagline: 'Changed' }, ...asUser(owner) })
    expect(await count()).toBe(before + 1)
  })
})
