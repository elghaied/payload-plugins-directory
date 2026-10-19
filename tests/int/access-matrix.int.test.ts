import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createPayloadRequest, Forbidden, handleEndpoints, NotFound, ValidationError, type Payload, type Where } from 'payload'
import type { Maintainer } from '@/payload-types'
import { findPluginForRepository, findRepositoryIds } from '@/lib/submissions/duplicates'
import { getSessionSecret, signSessionToken, SESSION_COOKIE } from '@/lib/auth/session'
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
  it('syncTrashReason is readable by admins only', async () => {
    await payload.update({ collection: 'plugins', id: listedId, overrideAccess: true, data: { syncTrashReason: 'package-removed' } })
    const anon = await payload.findByID({ collection: 'plugins', id: listedId, overrideAccess: false, user: null, depth: 0 })
    expect(anon).not.toHaveProperty('syncTrashReason')
    const asAdmin = await payload.findByID({ collection: 'plugins', id: listedId, overrideAccess: false, user: admin as never, depth: 0 })
    expect(asAdmin.syncTrashReason).toBe('package-removed')
    await payload.update({ collection: 'plugins', id: listedId, overrideAccess: true, data: { syncTrashReason: null } })
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
      context: { skipRevalidate: true }, // this test is about authorship, not the job queue it later counts
      data: { title: 'Auth', slug: 'auth' },
    })
    const anon = await payload.findByID({ collection: 'categories', id: created.id, overrideAccess: false, user: null, depth: 0 })
    expect(anon).not.toHaveProperty('createdBy')
    expect(anon).not.toHaveProperty('updatedBy')
    const asAdmin = await payload.findByID({ collection: 'categories', id: created.id, overrideAccess: false, user: admin as never, depth: 0 })
    expect(asAdmin.createdBy).toEqual({ relationTo: 'users', value: editor.id })
    await payload.delete({ collection: 'categories', id: created.id, overrideAccess: true, context: { skipRevalidate: true } })
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
  it('jobs are admin-only: anonymous users and maintainers cannot read, create or queue them', async () => {
    const job = await payload.jobs.queue({ task: 'snapshot', input: {}, queue: 'default', overrideAccess: true })
    for (const user of [null, maintainer]) {
      await expect(payload.find({ collection: 'payload-jobs', overrideAccess: false, user: user as never })).rejects.toThrow(Forbidden)
      await expect(
        payload.create({ collection: 'payload-jobs', overrideAccess: false, user: user as never, data: { taskSlug: 'snapshot', input: {} } as never }),
      ).rejects.toThrow(Forbidden)
      const req = await createPayloadRequest({ payload, user: user as never })
      await expect(payload.jobs.queue({ task: 'snapshot', input: {}, queue: 'default', req, overrideAccess: false })).rejects.toThrow(Forbidden)
    }
    const asAdmin = await payload.find({
      collection: 'payload-jobs', overrideAccess: false, user: admin as never, where: { taskSlug: { equals: 'snapshot' } },
    })
    expect(asAdmin.docs.map((d) => d.id)).toEqual([job.id])
    // Read-only for admins too: jobs are only created through payload.jobs.queue by system code.
    await expect(
      payload.create({ collection: 'payload-jobs', overrideAccess: false, user: admin as never, data: { taskSlug: 'snapshot', input: {} } as never }),
    ).rejects.toThrow(Forbidden)
    await payload.delete({ collection: 'payload-jobs', id: job.id, overrideAccess: true })
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
    const res = await payload.find({ collection: 'submissions', overrideAccess: false, user: maintainerA, depth: 0 })
    expect(res.docs.every((d) => relId(d.submittedBy) === maintainerA.id)).toBe(true)
    expect(res.docs.map((d) => d.id)).toContain(submissionA)
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
  it('stores the canonical URL', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerB,
      data: { type: 'listing', url: 'github.com/B/Four.git', submittedBy: maintainerB.id, status: 'pending' },
    })
    expect(doc.url).toBe('https://github.com/b/four')
  })
  it('rejects a listing URL outside github.com / npmjs.com', async () => {
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user: maintainerB,
        data: { type: 'listing', url: 'https://evil.example/a/b', submittedBy: maintainerB.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
  it('rejects a duplicate of a pending listing (even from another maintainer)', async () => {
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user: maintainerB,
        data: { type: 'listing', url: 'https://github.com/A/One', submittedBy: maintainerB.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
  it('rejects a listing for a repository that is already listed', async () => {
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user: maintainerB,
        data: { type: 'listing', url: 'https://github.com/acme/plugin', submittedBy: maintainerB.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
  it('strips `plugin` from a maintainer listing submission', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerB,
      data: { type: 'listing', url: 'https://github.com/b/five', plugin: listedId, submittedBy: maintainerB.id, status: 'pending' },
    })
    const stored = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true, depth: 0 })
    expect(stored.plugin ?? null).toBeNull()
  })
  it('rejects a second pending claim for the same plugin', async () => {
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user: maintainerA,
        data: { type: 'claim', plugin: listedId, submittedBy: maintainerA.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
  it('a maintainer cannot set repositoryFullName', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerB,
      data: { type: 'listing', url: 'https://github.com/b/six', repositoryFullName: 'evil/repo', submittedBy: maintainerB.id, status: 'pending' },
    })
    const stored = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true })
    expect(stored.repositoryFullName ?? null).toBeNull()
  })
  it('a maintainer cannot update a submission (no re-targeting a claim after create)', async () => {
    const own = await payload.find({ collection: 'submissions', overrideAccess: false, user: maintainerA, limit: 1 })
    await expect(
      payload.update({ collection: 'submissions', id: own.docs[0].id, overrideAccess: false, user: maintainerA, data: { plugin: hiddenId } }),
    ).rejects.toThrow(Forbidden)
  })
  it('caps a maintainer at 10 pending requests', async () => {
    const fresh = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 5000, login: 'spammer' } })
    const user = { ...fresh, collection: 'maintainers' } as const
    for (let i = 0; i < 10; i++) {
      await payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user,
        data: { type: 'listing', url: `https://github.com/spam/r${i}`, submittedBy: fresh.id, status: 'pending' },
      })
    }
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user,
        data: { type: 'listing', url: 'https://github.com/spam/r10', submittedBy: fresh.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
  it('submissions read by their maintainer carry no createdBy/updatedBy', async () => {
    const res = await payload.find({ collection: 'submissions', overrideAccess: false, user: maintainerA })
    for (const doc of res.docs) {
      expect(doc).not.toHaveProperty('createdBy')
      expect(doc).not.toHaveProperty('updatedBy')
    }
  })

  it('rejects a repository already known when the stored name differs in case, among many similar names', async () => {
    for (let i = 0; i < 25; i++) {
      await payload.create({
        collection: 'repositories',
        overrideAccess: true,
        data: { fullName: `Dup/Plugin-${i}`, owner: 'Dup', url: `https://github.com/Dup/Plugin-${i}` },
      })
    }
    const repo = await payload.create({
      collection: 'repositories',
      overrideAccess: true,
      data: { fullName: 'Dup/Plugin', owner: 'Dup', url: 'https://github.com/Dup/Plugin' },
    })
    await payload.create({
      collection: 'plugins',
      overrideAccess: true,
      data: { slug: 'dup-plugin', name: 'dup-plugin', repository: repo.id, url: repo.url, visibility: 'listed', source: 'topic' },
    })
    expect(await findRepositoryIds(payload, 'dup/plugin')).toEqual([repo.id])
    expect(await findPluginForRepository(payload, 'dup/plugin')).toMatchObject({ slug: 'dup-plugin' })
    await expect(
      payload.create({
        collection: 'submissions',
        overrideAccess: false,
        user: maintainerB,
        data: { type: 'listing', url: 'https://github.com/dup/plugin', submittedBy: maintainerB.id, status: 'pending' },
      }),
    ).rejects.toThrow(ValidationError)
  })
  it('a maintainer cannot set approval fields on create', async () => {
    const doc = await payload.create({
      collection: 'submissions',
      overrideAccess: false,
      user: maintainerB,
      data: { type: 'listing', url: 'https://github.com/b/seven', status: 'approved', rejectionReason: 'x', repositoryFullName: 'evil/repo', submittedBy: maintainerA.id },
    })
    const stored = await payload.findByID({ collection: 'submissions', id: doc.id, overrideAccess: true, depth: 0 })
    expect(stored).toMatchObject({ status: 'pending' })
    expect(stored.repositoryFullName ?? null).toBeNull()
    expect(stored.rejectionReason ?? null).toBeNull()
    expect(relId(stored.submittedBy)).toBe(maintainerB.id)
  })
})

describe('maintainers (self access)', () => {
  let asAdmin: never
  let adminUserId: number
  beforeAll(async () => {
    const adminUser = await payload.create({
      collection: 'users',
      overrideAccess: true,
      data: { email: 'self-access-admin@example.com', password: 'a-long-test-password-123' },
    })
    adminUserId = adminUser.id
    asAdmin = { ...adminUser, collection: 'users' } as never
  })
  // Every test starts from the same maintainer state, whatever ran before it.
  beforeEach(async () => {
    for (const [id, githubId, login] of [[maintainerA.id, 42, 'octo'], [maintainerB.id, 43, 'other']] as const) {
      await payload.update({
        collection: 'maintainers',
        id,
        overrideAccess: true,
        data: { githubId, login, name: null, avatarUrl: null, blocked: false, sessionsValidAfter: null },
      })
    }
  })

  it('a maintainer reads only themselves', async () => {
    const res = await payload.find({ collection: 'maintainers', overrideAccess: false, user: maintainerA })
    expect(res.docs.map((d) => d.id)).toEqual([maintainerA.id])
  })
  // Maintainer self-update is denied outright until a self-editable field exists: an update that changes
  // nothing editable would still re-stamp updatedBy. Identity and moderation fields are therefore unreachable.
  it('a maintainer cannot update their own document (identity and moderation fields stay put)', async () => {
    await expect(
      payload.update({
        collection: 'maintainers',
        id: maintainerA.id,
        overrideAccess: false,
        user: maintainerA,
        data: { login: 'renamed', githubId: 1, name: 'Mallory', avatarUrl: 'https://evil.example/a.png', blocked: true, sessionsValidAfter: new Date(0).toISOString() },
      }),
    ).rejects.toThrow(Forbidden)
    const stored = await payload.findByID({ collection: 'maintainers', id: maintainerA.id, overrideAccess: true })
    expect(stored).toMatchObject({ login: 'octo', githubId: 42, blocked: false })
    expect(stored.name ?? null).toBeNull()
    expect(stored.avatarUrl ?? null).toBeNull()
    expect(stored.sessionsValidAfter ?? null).toBeNull()
  })
  it('a maintainer cannot read the moderation fields of their own document', async () => {
    const self = await payload.findByID({ collection: 'maintainers', id: maintainerA.id, overrideAccess: false, user: maintainerA })
    expect(self).not.toHaveProperty('blocked')
    expect(self).not.toHaveProperty('sessionsValidAfter')
  })
  it('a maintainer cannot read another maintainer', async () => {
    await expect(
      payload.findByID({ collection: 'maintainers', id: maintainerB.id, overrideAccess: false, user: maintainerA }),
    ).rejects.toThrow(NotFound)
  })
  it('a maintainer cannot update another maintainer', async () => {
    await expect(
      payload.update({ collection: 'maintainers', id: maintainerB.id, overrideAccess: false, user: maintainerA, data: {} }),
    ).rejects.toThrow(Forbidden)
  })
  it('a maintainer cannot create or delete maintainers', async () => {
    await expect(
      payload.create({ collection: 'maintainers', overrideAccess: false, user: maintainerA, data: { githubId: 77, login: 'x' } }),
    ).rejects.toThrow(Forbidden)
    await expect(
      payload.delete({ collection: 'maintainers', id: maintainerB.id, overrideAccess: false, user: maintainerA }),
    ).rejects.toThrow(Forbidden)
  })
  it('a maintainer has no admin-panel access', async () => {
    const config = payload.config.collections.find((c) => c.slug === 'maintainers')!
    const access = config.access!.admin as (a: never) => unknown
    expect(await access({ req: { user: maintainerA, payload } } as never)).toBe(false)
  })
  it('admin users keep full access, including the moderation fields', async () => {
    const all = await payload.find({ collection: 'maintainers', overrideAccess: false, user: asAdmin })
    expect(all.docs.map((d) => d.id)).toEqual(expect.arrayContaining([maintainerA.id, maintainerB.id]))
    const updated = await payload.update({
      collection: 'maintainers',
      id: maintainerB.id,
      overrideAccess: false,
      user: asAdmin,
      data: { blocked: true },
    })
    expect(updated.blocked).toBe(true)
  })
  it('authorship is admin-only: stamped by an admin edit, never visible to the maintainer', async () => {
    await payload.update({ collection: 'maintainers', id: maintainerA.id, overrideAccess: false, user: asAdmin, data: { name: 'Octo Cat' } })
    const forAdmin = await payload.findByID({ collection: 'maintainers', id: maintainerA.id, overrideAccess: false, user: asAdmin, depth: 0 })
    expect(forAdmin.updatedBy).toEqual({ relationTo: 'users', value: adminUserId })
    const self = await payload.findByID({ collection: 'maintainers', id: maintainerA.id, overrideAccess: false, user: maintainerA })
    expect(self.name).toBe('Octo Cat')
    expect(self).not.toHaveProperty('createdBy')
    expect(self).not.toHaveProperty('updatedBy')
  })
})

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)
const revalidateJobs = async () =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, limit: 0, sort: 'createdAt', where: { taskSlug: { equals: 'revalidate' } } })).docs.map(
    (j) => j.input,
  )

describe('plugins (maintainer edits)', () => {
  beforeAll(async () => {
    for (const id of [listedId, hiddenId]) {
      await payload.update({ collection: 'plugins', id, overrideAccess: true, data: { maintainers: [maintainerA.id] } })
    }
  })
  const edit = (user: unknown, id: number, data: Record<string, unknown>, context?: Record<string, unknown>) =>
    payload.update({ collection: 'plugins', id, overrideAccess: false, user: user as never, data, depth: 0, context })

  it('a maintainer can set customTagline on a plugin they maintain', async () => {
    const doc = await edit(maintainerA, listedId, { customTagline: 'Fast forms' })
    expect(doc.customTagline).toBe('Fast forms')
  })
  it('a maintainer cannot change any other field, even alongside an allowed one', async () => {
    for (const data of [
      { name: 'pwned' },
      { customTagline: 'ok', visibility: 'hidden' },
      { maintainers: [maintainerA.id, maintainerB.id] },
      { healthScore: 100 },
      { ai: { summary: 'x' } },
      { locks: { summary: true } },
      { category: 1 },
      { tags: [1] },
      { slug: 'stolen' },
    ]) {
      await expect(edit(maintainerA, listedId, data)).rejects.toThrow(Forbidden)
    }
    const stored = await payload.findByID({ collection: 'plugins', id: listedId, overrideAccess: true, depth: 0 })
    expect(stored).toMatchObject({ name: 'listed-one', visibility: 'listed', customTagline: 'Fast forms', slug: 'listed-one' })
    expect(stored.maintainers).toEqual([maintainerA.id])
  })
  it('a maintainer cannot trash a plugin they maintain', async () => {
    await expect(edit(maintainerA, listedId, { deletedAt: new Date().toISOString() })).rejects.toThrow(Forbidden)
  })
  it('a maintainer cannot edit a plugin they do not maintain', async () => {
    await expect(edit(maintainerB, listedId, { customTagline: 'hijack' })).rejects.toThrow(Forbidden)
  })
  it('a maintainer cannot edit a hidden plugin, even one they maintain', async () => {
    await expect(edit(maintainerA, hiddenId, { customTagline: 'x' })).rejects.toThrow(Forbidden)
  })
  it('a bulk update by a maintainer touches only plugins they maintain', async () => {
    const res = await payload.update({
      collection: 'plugins',
      where: { slug: { exists: true } },
      overrideAccess: false,
      user: maintainerB,
      data: { customTagline: 'bulk' },
    })
    expect(res.docs).toHaveLength(0)
  })
  it('anonymous cannot set customTagline', async () => {
    await expect(edit(null, listedId, { customTagline: 'anon' })).rejects.toThrow(Forbidden)
  })
  it('admins can still edit every field', async () => {
    const doc = await edit(admin, listedId, { name: 'listed-one', customTagline: 'Admin tagline' })
    expect(doc.customTagline).toBe('Admin tagline')
  })

  it('normalises customTagline on every path (NFKC, invisible characters, trim, clamp, empty -> null)', async () => {
    const doc = await edit(maintainerA, listedId, { customTagline: '  \u202eF\uff41st\u200b   forms\u0007  ' })
    expect(doc.customTagline).toBe('Fast forms')
    const clamped = await edit(admin, listedId, { customTagline: 'x'.repeat(500) })
    expect(clamped.customTagline).toHaveLength(120)
    const cleared = await edit(maintainerA, listedId, { customTagline: '  \u200b ' })
    expect(cleared.customTagline).toBeNull()
  })

  it('logo needs the branding context: a REST-style write cannot set it, the server action can', async () => {
    const media = await payload.create({
      collection: 'media',
      overrideAccess: true,
      data: { alt: 'logo' },
      file: { data: PNG_1X1, mimetype: 'image/png', name: 'logo.png', size: PNG_1X1.length },
    })
    await expect(edit(maintainerA, listedId, { logo: media.id })).rejects.toThrow(Forbidden)
    const ok = await edit(maintainerA, listedId, { logo: media.id }, { maintainerBranding: true })
    expect(relId(ok.logo)).toBe(media.id)
    const cleared = await edit(maintainerA, listedId, { logo: null }, { maintainerBranding: true })
    expect(cleared.logo ?? null).toBeNull()
  })

  describe('over REST', () => {
    const patch = async (maintainerId: number, githubId: number, body: Record<string, unknown>, id = listedId) => {
      const token = await signSessionToken({ maintainerId, githubId }, getSessionSecret())
      const res = await handleEndpoints({
        config: payload.config,
        request: new Request(`http://localhost/api/plugins/${id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}` },
          body: JSON.stringify(body),
        }),
      })
      return res.status
    }
    it('PATCH of customTagline by the maintainer succeeds; any other field or logo is refused', async () => {
      expect(await patch(maintainerA.id, 42, { customTagline: 'Via REST' })).toBe(200)
      for (const body of [{ name: 'x' }, { visibility: 'hidden' }, { logo: 1 }, { locks: { summary: true } }, { deletedAt: '2026-01-01T00:00:00.000Z' }]) {
        expect(await patch(maintainerA.id, 42, body)).toBe(403)
      }
      expect(await patch(maintainerB.id, 43, { customTagline: 'nope' })).toBe(403)
    })
  })

  describe('bulk updates by a maintainer', () => {
    const bulk = (where: Where, data: Record<string, unknown>, context?: Record<string, unknown>) =>
      payload.update({ collection: 'plugins', where, sort: 'slug', overrideAccess: false, user: maintainerA, data, depth: 0, context })
    const jobTags = async () => (await revalidateJobs()).map((j) => (j as { tags: string[] }).tags)
    let bulkA: number
    let bulkB: number
    beforeAll(async () => {
      const repo = (await payload.find({ collection: 'repositories', overrideAccess: true, limit: 1 })).docs[0]
      const make = async (slug: string, extra: Record<string, unknown> = {}) =>
        (
          await payload.create({
            collection: 'plugins',
            overrideAccess: true,
            context: { skipRevalidate: true },
            data: { slug, name: slug, repository: repo.id, url: repo.url, visibility: 'listed', source: 'topic', maintainers: [maintainerA.id], ...extra },
          })
        ).id
      bulkA = await make('bulk-a', { customTagline: 'Shared line' })
      bulkB = await make('bulk-b')
    })

    it('touches only the listed plugins the maintainer maintains (hidden ones are skipped)', async () => {
      const res = await bulk({ slug: { in: ['listed-one', 'hidden-one', 'bulk-a', 'bulk-b'] } }, { customTagline: 'Own plugins' })
      expect(res.docs.map((d) => d.slug)).toEqual(['bulk-a', 'bulk-b', 'listed-one'])
      expect(res.errors).toHaveLength(0)
      const hidden = await payload.findByID({ collection: 'plugins', id: hiddenId, overrideAccess: true, depth: 0 })
      expect(hidden.customTagline).not.toBe('Own plugins')
    })
    it('a disallowed key rejects the whole bulk request, touching nothing', async () => {
      await expect(bulk({ slug: { in: ['listed-one', 'bulk-a'] } }, { customTagline: 'nope', visibility: 'hidden' })).rejects.toThrow(Forbidden)
      await expect(bulk({ slug: { in: ['listed-one', 'bulk-a'] } }, { name: 'nope' })).rejects.toThrow(Forbidden)
      const stored = await payload.findByID({ collection: 'plugins', id: bulkA, overrideAccess: true, depth: 0 })
      expect(stored).toMatchObject({ visibility: 'listed', name: 'bulk-a', customTagline: 'Own plugins' })
    })
    it('an unchanged plugin does not suppress revalidation of a changed one in the same bulk update', async () => {
      await payload.update({ collection: 'plugins', id: bulkA, overrideAccess: true, context: { skipRevalidate: true }, data: { customTagline: 'Shared line' } })
      await payload.update({ collection: 'plugins', id: bulkB, overrideAccess: true, context: { skipRevalidate: true }, data: { customTagline: 'Other line' } })
      const before = (await jobTags()).length
      const res = await bulk({ slug: { in: ['bulk-a', 'bulk-b'] } }, { customTagline: 'Shared line' })
      expect(res.docs).toHaveLength(2)
      const added = (await jobTags()).slice(before)
      expect(added).toEqual([['plugins', 'plugin:bulk-b']])
    })
    it('a reused context object does not leak a skip into the next call', async () => {
      const ctx = { maintainerBranding: true }
      const edit1 = () => payload.update({ collection: 'plugins', id: bulkA, overrideAccess: false, user: maintainerA, data: { customTagline: 'Shared line' }, depth: 0, context: ctx })
      await edit1()
      const before = (await jobTags()).length
      await edit1() // unchanged: no job
      expect(await jobTags()).toHaveLength(before)
      await payload.update({ collection: 'plugins', id: bulkA, overrideAccess: false, user: maintainerA, data: { customTagline: 'Changed line' }, depth: 0, context: ctx })
      expect((await jobTags()).slice(before)).toEqual([['plugins', 'plugin:bulk-a']])
      expect(ctx).toEqual({ maintainerBranding: true })
    })
  })

  describe('phase 2 AI locks and revalidation', () => {
    it('a maintainer edit neither locks nor changes AI fields', async () => {
      await payload.update({
        collection: 'plugins',
        id: listedId,
        overrideAccess: true,
        context: { skipRevalidate: true },
        data: { ai: { tagline: 'AI tagline', summary: 'AI summary' } },
      })
      await edit(maintainerA, listedId, { customTagline: 'Maintainer tagline' })
      const stored = await payload.findByID({ collection: 'plugins', id: listedId, overrideAccess: true, depth: 0 })
      expect(stored.ai).toMatchObject({ tagline: 'AI tagline', summary: 'AI summary' })
      expect(stored.locks).toMatchObject({ tagline: false, summary: false, category: false, tags: false })
      expect(stored.customTagline).toBe('Maintainer tagline')
    })
    it('an admin edit of customTagline does not lock AI fields either', async () => {
      await edit(admin, listedId, { customTagline: 'Admin again' })
      const stored = await payload.findByID({ collection: 'plugins', id: listedId, overrideAccess: true, depth: 0 })
      expect(stored.locks).toMatchObject({ tagline: false, summary: false })
    })
    it('a branding edit queues exactly one revalidate job for the list and plugin tags', async () => {
      const before = (await revalidateJobs()).length
      await edit(maintainerA, listedId, { customTagline: 'Brand new tagline' })
      const jobs = await revalidateJobs()
      expect(jobs).toHaveLength(before + 1)
      expect(jobs.at(-1)).toEqual({ tags: ['plugins', 'plugin:listed-one'] })
    })
    it('an unchanged maintainer save queues no revalidate job', async () => {
      await edit(maintainerA, listedId, { customTagline: 'Same tagline' })
      const before = (await revalidateJobs()).length
      await edit(maintainerA, listedId, { customTagline: ' Same tagline ' })
      expect(await revalidateJobs()).toHaveLength(before)
    })
  })
})

describe('media', () => {
  it('maintainers cannot upload media directly', async () => {
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: false,
        user: maintainerA,
        data: { alt: 'x' },
        file: { data: PNG_1X1, mimetype: 'image/png', name: 'x.png', size: PNG_1X1.length },
      }),
    ).rejects.toThrow(Forbidden)
  })
  it('media rejects SVG uploads even for admins', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    await expect(
      payload.create({
        collection: 'media',
        overrideAccess: true,
        data: { alt: 'x' },
        file: { data: svg, mimetype: 'image/svg+xml', name: 'x.svg', size: svg.length },
      }),
    ).rejects.toThrow()
  })
})
