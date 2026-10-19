import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { eq } from '@payloadcms/db-postgres/drizzle'
import { jobStatus } from '@/db/jobStatus'
import { recordGitHubQuota, recordJobFailure, recordJobSuccess } from '@/sync/jobStatus'
import { trashPlugins } from '@/sync/trash'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const T1 = new Date('2026-10-19T01:00:00Z')
const T2 = new Date('2026-10-19T02:00:00Z')
const T3 = new Date('2026-10-19T03:00:00Z')

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('trashPlugins', () => {
  it('trashes active plugins with a reason, returns their slugs and leaves already-trashed ones alone', async () => {
    const repo = await createRepo(payload)
    const a = await createPlugin(payload, repo.id, { slug: 'a' })
    await createPlugin(payload, repo.id, { slug: 'b' })
    await payload.update({ collection: 'plugins', id: a.id, overrideAccess: true, data: { deletedAt: T1.toISOString() } })

    expect(await trashPlugins(payload, { repository: { equals: repo.id } }, 'repository-gone', T2)).toEqual(['b'])

    const docs = (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, sort: 'slug', where: { repository: { equals: repo.id } } })).docs
    expect(docs.map((d) => [d.slug, d.syncTrashReason ?? null, d.deletedAt])).toEqual([
      ['a', null, T1.toISOString()],
      ['b', 'repository-gone', T2.toISOString()],
    ])
  })
})

describe('syncTrashReason lifecycle', () => {
  const get = async (id: number) => payload.findByID({ collection: 'plugins', id, trash: true, overrideAccess: true, depth: 0 })

  it('is set by sync trash, cleared by an admin restore, and cleared by a later admin trash', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'lc' })
    await trashPlugins(payload, { id: { equals: p.id } }, 'package-removed', T1)
    expect((await get(p.id)).syncTrashReason).toBe('package-removed')

    await payload.update({ collection: 'plugins', id: p.id, trash: true, overrideAccess: true, data: { deletedAt: null } })
    expect((await get(p.id)).syncTrashReason ?? null).toBeNull()

    // stale reason on a live plugin, then an admin trashes it
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { syncTrashReason: 'package-removed' } })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { deletedAt: T2.toISOString() } })
    const after = await get(p.id)
    expect(after.deletedAt).toBe(T2.toISOString())
    expect(after.syncTrashReason ?? null).toBeNull()
  })
})

describe('job status', () => {
  const row = async (key: string) => (await payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, key)))[0]

  it('upserts success and failure without clobbering each other', async () => {
    await recordJobSuccess(payload, 'discover', { status: 'ok', discovered: 3 }, T1)
    await recordJobFailure(payload, 'discover', new Error('boom'), T2)
    await recordJobSuccess(payload, 'discover', { status: 'ok', discovered: 4 }, T3)
    expect(await row('discover')).toMatchObject({
      lastSuccessAt: T3, lastFailureAt: T2, lastError: 'boom', details: { status: 'ok', discovered: 4 },
    })
  })

  it('never lets an older write overwrite a newer one', async () => {
    await recordJobSuccess(payload, 'k', { v: 2 }, T2)
    await recordJobSuccess(payload, 'k', { v: 1 }, T1)
    await recordJobFailure(payload, 'k', new Error('new'), T2)
    await recordJobFailure(payload, 'k', new Error('old'), T1)
    expect(await row('k')).toMatchObject({ lastSuccessAt: T2, details: { v: 2 }, lastFailureAt: T2, lastError: 'new' })
  })

  it('stores the GitHub quota and ignores a missing one', async () => {
    await recordGitHubQuota(payload, null, T1)
    expect(await payload.db.drizzle.select().from(jobStatus)).toEqual([])
    await recordGitHubQuota(payload, { remaining: 4200, limit: 5000, resetAt: '2026-10-19T13:00:00.000Z' }, T1)
    expect(await row('github-quota')).toMatchObject({ lastSuccessAt: T1, details: { remaining: 4200, limit: 5000 } })
  })
})
