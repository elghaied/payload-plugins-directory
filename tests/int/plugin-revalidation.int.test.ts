import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { runEnrich } from '@/enrich/enrichPlugin'
import { runSyncRepository } from '@/sync/syncRepository'
import { trashPlugins } from '@/sync/trash'
import { fakeEnrichClient, okMessage } from '../helpers/fakeEnrichClient'
import { ghRepo, json, pkg, raw, repoById, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext, syncFetch } from './helpers/syncContext'
import { createTestTaxonomy, goodOutput } from './helpers/taxonomy'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')
const revalidates = async () =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, sort: 'createdAt', where: { taskSlug: { equals: 'revalidate' } } })).docs.map((j) => j.input)

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('Plugins admin-edit revalidation hook', () => {
  it('queues one job with the list and plugin tags when an admin changes visibility', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'acme-a' })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { visibility: 'hidden' } })
    expect(await revalidates()).toEqual([{ tags: ['plugins', 'plugin:acme-a'] }])
  })

  it('includes the old and the new plugin tag on a slug rename', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'old-slug' })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { slug: 'new-slug' } })
    expect(await revalidates()).toEqual([{ tags: ['plugins', 'plugin:new-slug', 'plugin:old-slug'] }])
  })

  it('queues nothing when the write carries context.skipRevalidate', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id)
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, context: { skipRevalidate: true }, data: { name: 'Quiet' } })
    expect(await revalidates()).toEqual([])
  })

  it('queues one job when a plugin is trashed through update({ deletedAt })', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'to-trash' })
    await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, data: { deletedAt: NOW.toISOString() } })
    expect(await revalidates()).toEqual([{ tags: ['plugins', 'plugin:to-trash'] }])
  })

  it('queues one job on a hard delete', async () => {
    const repo = await createRepo(payload)
    const p = await createPlugin(payload, repo.id, { slug: 'gone' })
    await payload.delete({ collection: 'plugins', id: p.id, overrideAccess: true })
    expect(await revalidates()).toEqual([{ tags: ['plugins', 'plugin:gone'] }])
  })

  it('queues one job for an admin create', async () => {
    const repo = await createRepo(payload)
    await payload.create({
      collection: 'plugins', overrideAccess: true,
      data: { slug: 'made', name: 'Made', repository: repo.id, url: 'https://github.com/acme/made', source: 'submission' } as never,
    })
    expect(await revalidates()).toEqual([{ tags: ['plugins', 'plugin:made'] }])
  })

  it('does not add a job to a sync run (create, update, trash)', async () => {
    const repo = ghRepo(7, 'acme/payload-seo', { pushed_at: '2026-10-18T09:00:00Z', topics: ['payload-plugin'] })
    const routes = (r = repo, name = 'payload-seo') => ({
      [repoById(r.id)]: json(r),
      [raw(r.full_name, 'package.json')]: pkg({ name, description: 'SEO', peerDependencies: { payload: '^3.0.0' } }),
      [raw(r.full_name, 'README.md')]: text('# SEO'),
    })
    const run = (r: Record<string, ReturnType<typeof json>>) =>
      runSyncRepository(payload, { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, syncContext(syncFetch(r), NOW))
    expect((await run(routes())).created).toEqual(['7-root'])
    expect((await run(routes({ ...repo, stargazers_count: 99, pushed_at: '2026-10-19T09:00:00Z' }, 'payload-seo-2'))).updated).toEqual(['7-root'])
    expect(await trashPlugins(payload, { slug: { equals: '7-root' } }, 'package-removed', NOW)).toEqual(['7-root'])
    expect(await revalidates()).toEqual([])
  })

  it('does not add a job to an enrichment apply', async () => {
    await createTestTaxonomy(payload)
    const repo = await createRepo(payload, { topics: ['payload-plugin'] })
    const p = await createPlugin(payload, repo.id, { slug: 'acme-s3', contentHash: 'hash-1', description: 'S3', readme: '# S3' })
    const r = await runEnrich(payload, p.id, fakeEnrichClient((req) => okMessage(goodOutput(), { model: req.model })), () => NOW)
    expect(r.status).toBe('applied')
    expect(await revalidates()).toEqual([])
  })
})
