import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Forbidden, ValidationError, type Payload } from 'payload'
import type { Maintainer } from '@/payload-types'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const admin = { id: 1, collection: 'users' } as const
const maintainer = { id: 1, collection: 'maintainers' } as const
let maintainerA: Maintainer & { collection: 'maintainers' }
let maintainerB: Maintainer & { collection: 'maintainers' }
let listedId: number
let hiddenId: number

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
  // Soft-delete (move to trash). In 4.0.0-beta.2 `payload.delete` removes the row permanently even on a
  // trash-enabled collection, so trash is set through `deletedAt`, as the admin UI's "Move to trash" does.
  await payload.update({
    collection: 'plugins',
    id: trashed.docs[0].id,
    overrideAccess: true,
    data: { deletedAt: new Date().toISOString() },
  })
  const all = await payload.find({ collection: 'plugins', overrideAccess: true })
  listedId = all.docs.find((d) => d.slug === 'listed-one')!.id
  hiddenId = all.docs.find((d) => d.slug === 'hidden-one')!.id
  const a = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 42, login: 'octo' } })
  const b = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 43, login: 'other' } })
  maintainerA = { ...a, collection: 'maintainers' }
  maintainerB = { ...b, collection: 'maintainers' }
})
afterAll(async () => resetDatabase(payload))

const slugs = (docs: { slug: string }[]) => docs.map((d) => d.slug).sort()
const relId = (v: unknown) => (typeof v === 'object' && v !== null ? (v as { id: number }).id : v)

describe('access matrix', () => {
  it('anonymous sees only listed, non-trashed plugins', async () => {
    const res = await payload.find({ collection: 'plugins', overrideAccess: false, user: null })
    expect(slugs(res.docs)).toEqual(['listed-one'])
  })
  it('admin sees listed and hidden plugins', async () => {
    const res = await payload.find({ collection: 'plugins', overrideAccess: false, user: admin as never })
    expect(slugs(res.docs)).toEqual(['hidden-one', 'listed-one'])
  })
  it('the trashed plugin is really in the trash (not hard-deleted)', async () => {
    const res = await payload.find({
      collection: 'plugins',
      overrideAccess: true,
      trash: true,
      where: { slug: { equals: 'trashed-one' } },
    })
    expect(res.docs).toHaveLength(1)
    expect(res.docs[0].deletedAt).toEqual(expect.any(String))
  })
  it('admin sees the trashed plugin with trash: true', async () => {
    const res = await payload.find({ collection: 'plugins', overrideAccess: false, user: admin as never, trash: true })
    expect(slugs(res.docs)).toEqual(['hidden-one', 'listed-one', 'trashed-one'])
  })
  it('anonymous never sees the trashed plugin, even with trash: true', async () => {
    const res = await payload.find({ collection: 'plugins', overrideAccess: false, user: null, trash: true })
    expect(slugs(res.docs)).toEqual(['listed-one'])
  })
  it('anonymous cannot create plugins', async () => {
    await expect(
      payload.create({
        collection: 'plugins',
        overrideAccess: false,
        user: null,
        data: { slug: 'x', name: 'x', repository: 1, url: 'u', source: 'topic', visibility: 'listed' },
      }),
    ).rejects.toThrow(Forbidden)
  })
  it('anonymous cannot read maintainers, users, or submissions', async () => {
    for (const collection of ['maintainers', 'users', 'submissions'] as const) {
      await expect(payload.find({ collection, overrideAccess: false, user: null })).rejects.toThrow(Forbidden)
    }
  })
  it('maintainer cannot update plugins', async () => {
    await expect(
      payload.update({ collection: 'plugins', id: listedId, overrideAccess: false, user: maintainer as never, data: { name: 'pwned' } }),
    ).rejects.toThrow(Forbidden)
  })
  it('anonymous can read repositories, categories, tags', async () => {
    const expected = { repositories: 1, categories: 0, tags: 0 } as const
    for (const collection of ['repositories', 'categories', 'tags'] as const) {
      const res = await payload.find({ collection, overrideAccess: false, user: null })
      expect(res.totalDocs).toBe(expected[collection])
    }
  })
  it('anonymous plugin and repository docs carry no createdBy/updatedBy', async () => {
    for (const collection of ['plugins', 'repositories'] as const) {
      const res = await payload.find({ collection, overrideAccess: false, user: null })
      expect(res.docs.length).toBeGreaterThan(0)
      for (const doc of res.docs) {
        expect(doc).not.toHaveProperty('createdBy')
        expect(doc).not.toHaveProperty('updatedBy')
      }
    }
  })
  it('authorship on categories is stamped but readable only by admins', async () => {
    const editor = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: { email: 'editor@example.com', password: 'correct-horse-battery-staple' },
    })
    const editorUser = { ...editor, collection: 'users' } as never
    const created = await payload.create({
      collection: 'categories',
      overrideAccess: false,
      user: editorUser,
      data: { title: 'Auth', slug: 'auth' },
    })
    const anon = await payload.findByID({ collection: 'categories', id: created.id, overrideAccess: false, user: null, depth: 0 })
    expect(anon).not.toHaveProperty('createdBy')
    expect(anon).not.toHaveProperty('updatedBy')
    const asAdmin = await payload.findByID({ collection: 'categories', id: created.id, overrideAccess: false, user: admin as never, depth: 0 })
    expect(asAdmin.createdBy).toEqual({ relationTo: 'users', value: editor.id })
    await payload.delete({ collection: 'categories', id: created.id, overrideAccess: true })
    await payload.delete({ collection: 'users', id: editor.id, overrideAccess: true })
  })
  it('anonymous cannot read the settings global authorship', async () => {
    const settings = await payload.findGlobal({ slug: 'directory-settings', overrideAccess: false, user: null })
    expect(settings).not.toHaveProperty('createdBy')
    expect(settings).not.toHaveProperty('updatedBy')
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

describe('submissions', () => {
  let submissionA: number
  let submissionB: number

  it('a maintainer can create a listing submission, owned by themselves', async () => {
    const a = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerA,
      data: { type: 'listing', url: 'https://github.com/a/one', submittedBy: maintainerA.id, status: 'pending' },
    })
    const b = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerB,
      data: { type: 'listing', url: 'https://github.com/b/one', submittedBy: maintainerB.id, status: 'pending' },
    })
    submissionA = a.id
    submissionB = b.id
    expect(relId(a.submittedBy)).toBe(maintainerA.id)
    expect(relId(b.submittedBy)).toBe(maintainerB.id)
  })
  it("a maintainer sees only their own submissions", async () => {
    const res = await payload.find({ collection: 'submissions', overrideAccess: false, user: maintainerA })
    expect(res.docs.map((d) => d.id)).toEqual([submissionA])
    expect(res.docs.map((d) => d.id)).not.toContain(submissionB)
  })
  it('a maintainer cannot set status or rejectionReason on create', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerA,
      data: { type: 'listing', url: 'https://github.com/a/two', submittedBy: maintainerA.id, status: 'approved', rejectionReason: 'x' },
    })
    const stored = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true })
    expect(stored.status).toBe('pending')
    expect(stored.rejectionReason ?? undefined).toBeUndefined()
  })
  it('a maintainer cannot file a submission as another maintainer', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerA,
      data: { type: 'listing', url: 'https://github.com/a/three', submittedBy: maintainerB.id, status: 'pending' },
    })
    const stored = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true, depth: 0 })
    expect(relId(stored.submittedBy)).toBe(maintainerA.id)
  })
  it('a maintainer can claim a listed plugin', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerA,
      data: { type: 'claim', plugin: listedId, submittedBy: maintainerA.id, status: 'pending' },
    })
    expect(relId(doc.plugin)).toBe(listedId)
  })
  it('a maintainer cannot claim a hidden plugin', async () => {
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user: maintainerA,
        data: { type: 'claim', plugin: hiddenId, submittedBy: maintainerA.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
})
