import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { runSyncRepository } from '@/sync/syncRepository'
import { ghRepo, json, pkg, raw, repoById, text } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext, syncFetch } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')
const revalidates = async () =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, sort: 'createdAt', where: { taskSlug: { equals: 'revalidate' } } })).docs.map((j) => j.input)

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('Repositories admin-edit revalidation hook', () => {
  it('queues one job with the list tag and the tag of each plugin in the repository', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'mono-b' })
    await createPlugin(payload, repo.id, { slug: 'mono-a' })
    const other = await createRepo(payload)
    await createPlugin(payload, other.id, { slug: 'elsewhere' })
    await payload.update({ collection: 'repositories', id: repo.id, overrideAccess: true, data: { ownerAvatar: 'https://example.com/a.png' } })
    const jobs = await revalidates()
    expect(jobs).toHaveLength(1)
    expect((jobs[0] as { tags: string[] }).tags.slice().sort()).toEqual(['plugin:mono-a', 'plugin:mono-b', 'plugins'])
  })

  it('queues only the list tag for a repository without plugins', async () => {
    const repo = await createRepo(payload)
    await payload.update({ collection: 'repositories', id: repo.id, overrideAccess: true, data: { owner: 'renamed' } })
    expect(await revalidates()).toEqual([{ tags: ['plugins'] }])
  })

  it('queues nothing when the write carries context.skipRevalidate', async () => {
    const repo = await createRepo(payload)
    await payload.update({ collection: 'repositories', id: repo.id, overrideAccess: true, context: { skipRevalidate: true }, data: { owner: 'quiet' } })
    expect(await revalidates()).toEqual([])
  })

  it('does not add a job to a sync run (repository create and update)', async () => {
    const repo = ghRepo(7, 'acme/payload-seo', { pushed_at: '2026-10-18T09:00:00Z', topics: ['payload-plugin'] })
    const routes = (r = repo) => ({
      [repoById(r.id)]: json(r),
      [raw(r.full_name, 'package.json')]: pkg({ name: 'payload-seo', description: 'SEO', peerDependencies: { payload: '^3.0.0' } }),
      [raw(r.full_name, 'README.md')]: text('# SEO'),
    })
    const run = (r: Record<string, ReturnType<typeof json>>) =>
      runSyncRepository(payload, { fullName: 'acme/payload-seo', githubId: 7, source: 'topic' }, syncContext(syncFetch(r), NOW))
    await run(routes())
    await run(routes({ ...repo, stargazers_count: 99, pushed_at: '2026-10-19T09:00:00Z' }))
    expect(await revalidates()).toEqual([])
  })
})
