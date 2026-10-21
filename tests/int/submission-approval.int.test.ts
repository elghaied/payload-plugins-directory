import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createPayloadRequest, ValidationError, type Payload } from 'payload'
import { relationId } from '@/lib/relationId'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
let makerId: number
let existingPluginId: number
// A real admin row: submissions keep authorship, so `updatedBy` must reference an existing user.
let admin: { id: number; collection: 'users' }

const approve = (id: number, extra: Record<string, unknown> = {}, context?: Record<string, unknown>) =>
  payload.update({ collection: 'submissions', id, overrideAccess: false, user: admin as never, data: { status: 'approved', ...extra }, context, depth: 0 })

const listing = (url: string) =>
  payload.create({
    collection: 'submissions', overrideAccess: true, depth: 0,
    data: { type: 'listing', url, submittedBy: makerId, status: 'pending' },
  })

async function syncJobs() {
  const jobs = await payload.find({ collection: 'payload-jobs', overrideAccess: true, limit: 100, where: { taskSlug: { equals: 'sync-repository' } } })
  return jobs.docs.map((j) => ({ fullName: (j.input as { fullName: string }).fullName, input: j.input as Record<string, unknown>, queue: j.queue }))
}
const queuedSyncs = async () => (await syncJobs()).map((j) => j.fullName).sort()
const revalidateJobs = async () =>
  (await payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })).totalDocs

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const adminDoc = await payload.create({ collection: 'users', overrideAccess: true, data: { email: 'admin@example.com', password: 'correct-horse-battery-staple' } })
  admin = { id: adminDoc.id, collection: 'users' }
  makerId = (await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 9, login: 'maker' } })).id
  const repo = await payload.create({
    collection: 'repositories', overrideAccess: true,
    data: { fullName: 'Known/Repo', owner: 'Known', url: 'https://github.com/Known/Repo' },
  })
  existingPluginId = (
    await payload.create({
      collection: 'plugins', overrideAccess: true,
      data: { slug: 'known', name: 'Known', repository: repo.id, url: repo.url, source: 'topic', visibility: 'hidden' },
    })
  ).id
})
afterAll(async () => resetDatabase(payload))

describe('approving submissions', () => {
  it('a GitHub listing: stores repositoryFullName and enqueues sync-repository on the sync queue as a submission', async () => {
    const s = await listing('https://github.com/fresh/plugin')
    const doc = await approve(s.id)
    expect(doc.repositoryFullName).toBe('fresh/plugin')
    const job = (await syncJobs()).find((j) => j.fullName === 'fresh/plugin')
    expect(job).toBeDefined()
    expect(job!.queue).toBe('sync')
    expect(job!.input).toMatchObject({ fullName: 'fresh/plugin', source: 'submission', discovered: true })
    expect(doc.plugin ?? null).toBeNull()
  })
  it('a listing for a repository already in the directory links that plugin immediately', async () => {
    const s = await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'listing', url: 'https://github.com/known/repo', submittedBy: makerId, status: 'pending' },
    })
    await approve(s.id)
    const stored = await payload.findByID({ collection: 'submissions', id: s.id, overrideAccess: true, depth: 0 })
    expect(relationId(stored.plugin)).toBe(existingPluginId)
    expect(await queuedSyncs()).toContain('known/repo')
  })
  it('an npm listing resolves its repository through the registry resolver (injected)', async () => {
    const s = await listing('https://www.npmjs.com/package/@acme/npm-plugin')
    const doc = await approve(s.id, {}, { npmRepositoryResolver: async (name: string) => (name === '@acme/npm-plugin' ? 'acme/npm-plugin' : null) })
    expect(doc.repositoryFullName).toBe('acme/npm-plugin')
    expect(await queuedSyncs()).toContain('acme/npm-plugin')
  })
  it('an unresolvable npm listing cannot be approved until an admin enters owner/repo', async () => {
    const s = await listing('https://www.npmjs.com/package/orphan-plugin')
    await expect(approve(s.id, {}, { npmRepositoryResolver: async () => null })).rejects.toThrow(ValidationError)
    expect((await payload.findByID({ collection: 'submissions', id: s.id, overrideAccess: true })).status).toBe('pending')
    const doc = await approve(s.id, { repositoryFullName: 'Orphan/Plugin' }, { npmRepositoryResolver: async () => null })
    expect(doc.repositoryFullName).toBe('orphan/plugin')
    expect(await queuedSyncs()).toContain('orphan/plugin')
  })
  it('a registry failure keeps the submission pending with a distinct outage message', async () => {
    const s = await listing('https://www.npmjs.com/package/flaky-plugin')
    const warn = vi.spyOn(payload.logger, 'warn').mockImplementation(() => undefined)
    try {
      await expect(
        approve(s.id, {}, { npmRepositoryResolver: async () => { throw new Error('registry down') } }),
      ).rejects.toThrow(ValidationError)
      expect(warn).toHaveBeenCalled()
      const err = await approve(s.id, {}, { npmRepositoryResolver: async () => { throw new Error('registry down') } }).catch((e) => e)
      expect(JSON.stringify(err.data)).toMatch(/did not answer/)
      const missing = await approve(s.id, {}, { npmRepositoryResolver: async () => null }).catch((e) => e)
      expect(JSON.stringify(missing.data)).toMatch(/Could not find the GitHub repository/)
    } finally {
      warn.mockRestore()
    }
    expect((await payload.findByID({ collection: 'submissions', id: s.id, overrideAccess: true })).status).toBe('pending')
  })
  it('the plugin created later by sync is linked back to the approved submission', async () => {
    const repo = await payload.create({
      collection: 'repositories', overrideAccess: true,
      data: { fullName: 'Fresh/Plugin', owner: 'Fresh', url: 'https://github.com/Fresh/Plugin' },
    })
    const plugin = await payload.create({
      collection: 'plugins', overrideAccess: true,
      data: { slug: 'fresh-plugin', name: 'Fresh Plugin', repository: repo.id, url: repo.url, source: 'submission', visibility: 'listed' },
    })
    const subs = await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { repositoryFullName: { equals: 'fresh/plugin' } } })
    expect(relationId(subs.docs[0].plugin)).toBe(plugin.id)
  })
  it('approving a claim adds the maintainer once, without queuing a public revalidation', async () => {
    const claim = await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'claim', plugin: existingPluginId, submittedBy: makerId, status: 'pending' },
    })
    const before = await revalidateJobs()
    await approve(claim.id)
    await payload.update({ collection: 'submissions', id: claim.id, overrideAccess: true, data: { note: 'edited after approval' } })
    const plugin = await payload.findByID({ collection: 'plugins', id: existingPluginId, overrideAccess: true, depth: 0 })
    expect((plugin.maintainers ?? []).map(relationId)).toEqual([makerId])
    expect(await revalidateJobs()).toBe(before) // `maintainers` is not rendered publicly: addMaintainer skips revalidation
  })
  it('approving a listing never adds the submitter as a maintainer (ownership is not proven by a submission)', async () => {
    const s = await listing('https://github.com/known/repo')
    await approve(s.id)
    const plugin = await payload.findByID({ collection: 'plugins', id: existingPluginId, overrideAccess: true, depth: 0 })
    expect((plugin.maintainers ?? []).map(relationId)).toEqual([makerId]) // only from the earlier claim
    const other = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 77, login: 'other' } })
    const s2 = await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'listing', url: 'https://github.com/known/repo', submittedBy: other.id, status: 'pending' },
    })
    await approve(s2.id)
    const after = await payload.findByID({ collection: 'plugins', id: existingPluginId, overrideAccess: true, depth: 0 })
    expect((after.maintainers ?? []).map(relationId)).toEqual([makerId])
  })
  it('rejecting does nothing', async () => {
    const before = await queuedSyncs()
    const s = await listing('https://github.com/rejected/one')
    await payload.update({ collection: 'submissions', id: s.id, overrideAccess: true, data: { status: 'rejected', rejectionReason: 'Not a plugin' } })
    expect(await queuedSyncs()).toEqual(before)
  })

  describe('template listings', () => {
    const templateListing = (url: string, path: string | null) =>
      payload.create({
        collection: 'submissions', overrideAccess: true, depth: 0,
        data: { type: 'listing', kind: 'template', url, path, submittedBy: makerId, status: 'pending' },
      })
    const templateJobs = async () =>
      (await payload.find({ collection: 'payload-jobs', overrideAccess: true, limit: 100, where: { taskSlug: { equals: 'sync-template' } } })).docs.map((j) => ({
        input: j.input as Record<string, unknown>, queue: j.queue,
      }))

    it('approving a template submission queues one sync-template job with its path, and no sync-repository', async () => {
      const before = await queuedSyncs()
      const s = await templateListing('https://github.com/tpl/mono/tree/HEAD/apps/site', 'apps/site')
      const doc = await approve(s.id)
      expect(doc.repositoryFullName).toBe('tpl/mono')
      const jobs = (await templateJobs()).filter((j) => j.input.fullName === 'tpl/mono')
      expect(jobs).toEqual([{ input: { fullName: 'tpl/mono', path: 'apps/site', source: 'submission' }, queue: 'sync' }])
      expect(await queuedSyncs()).toEqual(before)
      const stored = await payload.findByID({ collection: 'submissions', id: s.id, overrideAccess: true, depth: 0 })
      expect(stored.plugin ?? null).toBeNull()
    })
    it('a root template submission queues sync-template with a null path', async () => {
      const s = await templateListing('https://github.com/tpl/root', null)
      await approve(s.id)
      const jobs = (await templateJobs()).filter((j) => j.input.fullName === 'tpl/root')
      expect(jobs.map((j) => j.input)).toEqual([{ fullName: 'tpl/root', path: null, source: 'submission' }])
    })
    it('when the template already exists, approval links it instead of queuing, and grants no maintainer rights', async () => {
      const repo = await payload.create({
        collection: 'repositories', overrideAccess: true,
        data: { fullName: 'Tpl/Existing', owner: 'Tpl', url: 'https://github.com/Tpl/Existing' },
      })
      const t = await payload.create({
        collection: 'templates', overrideAccess: true, depth: 0,
        data: { slug: '9-web', name: 'Existing', repository: repo.id, path: 'web', url: repo.url, source: 'submission', visibility: 'hidden' },
      })
      const s = await templateListing('https://github.com/tpl/existing/tree/HEAD/web', 'web')
      await approve(s.id)
      const stored = await payload.findByID({ collection: 'submissions', id: s.id, overrideAccess: true, depth: 0 })
      expect(relationId(stored.template)).toBe(t.id)
      expect((await templateJobs()).filter((j) => j.input.fullName === 'tpl/existing')).toEqual([])
      const after = await payload.findByID({ collection: 'templates', id: t.id, overrideAccess: true, depth: 0 })
      expect((after.maintainers ?? []).map(relationId)).toEqual([])
    })
    it('approving a plugin submission still queues sync-repository (regression)', async () => {
      const s = await listing('https://github.com/plain/plugin')
      await approve(s.id)
      expect(await queuedSyncs()).toContain('plain/plugin')
      expect((await templateJobs()).filter((j) => j.input.fullName === 'plain/plugin')).toEqual([])
    })
  })

  describe('claims and finality', () => {
    const makePlugin = async (slug: string) => {
      const repo = await payload.create({
        collection: 'repositories', overrideAccess: true,
        data: { fullName: `claims/${slug}`, owner: 'claims', url: `https://github.com/claims/${slug}` },
      })
      return payload.create({
        collection: 'plugins', overrideAccess: true,
        data: { slug, name: slug, repository: repo.id, url: repo.url, source: 'topic', visibility: 'listed' },
      })
    }
    const makeClaim = (pluginId: number, by: number) =>
      payload.create({ collection: 'submissions', overrideAccess: true, depth: 0, data: { type: 'claim', plugin: pluginId, submittedBy: by, status: 'pending' } })

    it('adding a maintainer does not leak into later writes on the same request: a public write still revalidates', async () => {
      const plugin = await makePlugin('leak-check')
      const claim = await makeClaim(plugin.id, makerId)
      const req = await createPayloadRequest({ payload, user: admin as never })
      const before = await revalidateJobs()
      await payload.update({ collection: 'submissions', id: claim.id, overrideAccess: false, req, data: { status: 'approved' }, depth: 0 })
      expect(await revalidateJobs()).toBe(before) // maintainers-only change: no purge
      expect((req.context as Record<string, unknown>).skipRevalidate).toBeUndefined()
      await payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: true, req, data: { name: 'Renamed' }, depth: 0 })
      expect(await revalidateJobs()).toBe(before + 1) // the public-visible write is not skipped
    })
    it('two claims on one plugin approved one after the other both end up as maintainers', async () => {
      const plugin = await makePlugin('two-claims')
      const other = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 501, login: 'second' } })
      const c1 = await makeClaim(plugin.id, makerId)
      const c2 = await makeClaim(plugin.id, other.id)
      await approve(c1.id)
      await approve(c2.id)
      const stored = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 0 })
      expect((stored.maintainers ?? []).map(relationId).sort()).toEqual([makerId, other.id].sort())
    })
    it('an approved claim is final', async () => {
      const plugin = await makePlugin('final-claim')
      const claim = await makeClaim(plugin.id, makerId)
      await approve(claim.id)
      for (const status of ['rejected', 'pending']) {
        const err = await payload.update({ collection: 'submissions', id: claim.id, overrideAccess: true, data: { status: status as 'rejected' } }).catch((e) => e)
        expect(err).toBeInstanceOf(ValidationError)
        expect(JSON.stringify(err.data)).toMatch(/Remove the maintainer from the plugin instead/)
      }
      expect((await payload.findByID({ collection: 'submissions', id: claim.id, overrideAccess: true })).status).toBe('approved')
    })
    it('an approved listing is final', async () => {
      const s = await listing('https://github.com/final/listing')
      await approve(s.id)
      const err = await payload.update({ collection: 'submissions', id: s.id, overrideAccess: true, data: { status: 'rejected', rejectionReason: 'x' } }).catch((e) => e)
      expect(err).toBeInstanceOf(ValidationError)
      expect(JSON.stringify(err.data)).toMatch(/Hide or trash the plugin instead/)
    })
    it('refuses to approve a claim whose plugin is trashed', async () => {
      const plugin = await makePlugin('trashed-claim')
      const claim = await makeClaim(plugin.id, makerId)
      await payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: true, data: { deletedAt: new Date().toISOString() } })
      const err = await approve(claim.id).catch((e) => e)
      expect(err).toBeInstanceOf(ValidationError)
      expect(JSON.stringify(err.data)).toMatch(/trashed or no longer exists/)
      expect((await payload.findByID({ collection: 'submissions', id: claim.id, overrideAccess: true })).status).toBe('pending')
    })
  })
})
