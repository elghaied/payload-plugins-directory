import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { runDiscover } from '@/sync/discover'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { ghRepo, npmRoutes, searchPage, searchResult } from '../fixtures/sync/github'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { syncContext } from './helpers/syncContext'

let payload: Payload
const NOW = new Date('2026-10-19T12:00:00Z')

const discover = (routes: Record<string, FakeRoute>) => runDiscover(payload, syncContext(fakeFetch(routes), NOW))
/** Known repositories acme/r1..r4 (GitHub ids 101..104), one listed plugin each; `missed` presets missedDiscoveries. */
async function knownRepos(missed: Record<number, number> = {}) {
  for (let i = 1; i <= 4; i++) {
    const repo = await createRepo(payload, { fullName: `acme/r${i}`, githubId: 100 + i, missedDiscoveries: missed[i] ?? 0 })
    await createPlugin(payload, repo.id, { slug: `${100 + i}-root` })
  }
}
const found = (...ids: number[]) => ids.map((id) => ghRepo(id, `acme/r${id - 100}`))
const search = (...ids: number[]): Record<string, FakeRoute> => ({ [searchPage(1)]: searchResult(found(...ids)) })
const repoDoc = async (fullName: string) =>
  (await payload.find({ collection: 'repositories', overrideAccess: true, where: { fullName: { equals: fullName } } })).docs[0]

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('runDiscover', () => {
  it('queues found repositories, the official monorepo and approved listing submissions', async () => {
    const m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'maint' } })
    const subs = [
      ['https://github.com/Acme/Sub-Repo', 'approved'],
      ['https://www.npmjs.com/package/payload-npm-only', 'approved'],
      ['https://github.com/acme/pending', 'pending'],
    ] as const
    for (const [url, status] of subs) {
      await payload.create({ collection: 'submissions', overrideAccess: true, data: { type: 'listing', url, status, submittedBy: m.id } })
    }
    const r = await discover({ ...search(101, 102), ...npmRoutes('payload-npm-only', { repositoryUrl: 'git+https://github.com/acme/npm-only.git' }) })
    expect(r).toMatchObject({ guardTripped: false, discovered: 5, known: 0, warning: null })
    const byName = [...r.toSync].sort((a, b) => (a.fullName.toLowerCase() < b.fullName.toLowerCase() ? -1 : 1))
    expect(byName).toEqual([
      { fullName: 'acme/npm-only', source: 'submission', discovered: true },
      { fullName: 'acme/r1', githubId: 101, source: 'topic', discovered: true },
      { fullName: 'acme/r2', githubId: 102, source: 'topic', discovered: true },
      { fullName: 'Acme/Sub-Repo', source: 'submission', discovered: true },
      { fullName: 'payloadcms/payload', source: 'official', discovered: true },
    ])
  })

  it('counts misses for known repositories absent from the search and trashes them on the third', async () => {
    await knownRepos()
    for (const expected of [1, 2]) {
      const r = await discover(search(101, 102, 103))
      expect(r).toMatchObject({ missed: ['acme/r4'], trashed: [], guardTripped: false })
      expect(r.toSync).toContainEqual({ fullName: 'acme/r4', githubId: 104, source: 'topic', discovered: false })
      expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(expected)
    }
    const third = await discover(search(101, 102, 103))
    expect(third).toMatchObject({ trashed: ['104-root'], revalidateTags: ['plugins', 'plugin:104-root'] })
    expect(third.toSync.some((s) => s.fullName === 'acme/r4')).toBe(false)
    const plugin = (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: '104-root' } } })).docs[0]
    expect(plugin.syncTrashReason).toBe('repository-gone')
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(0)
  })

  it('gives plugins an admin restored a fresh window of misses instead of trashing them again', async () => {
    await knownRepos({ 4: 2 })
    expect((await discover(search(101, 102, 103))).trashed).toEqual(['104-root'])
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(0)
    const trashedPlugin = (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: '104-root' } } })).docs[0]
    await payload.update({ collection: 'plugins', id: trashedPlugin.id, overrideAccess: true, trash: true, data: { deletedAt: null } })

    const next = await discover(search(101, 102, 103))
    expect(next).toMatchObject({ missed: ['acme/r4'], trashed: [] })
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(1)
    const restored = (await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: '104-root' } } })).docs[0]
    expect(restored.deletedAt ?? null).toBeNull()
  })

  it('counts a miss once when two runs overlap on the same snapshot', async () => {
    await knownRepos({ 3: 1 })
    const ctx = () => syncContext(fakeFetch(search(101, 102)), NOW)
    /** Both runs read the repositories, then both write: the interleaving that could double-count. */
    const overlapping = () => {
      let arrived = 0
      let release!: () => void
      const bothRead = new Promise<void>((resolve) => (release = resolve))
      const gated = new Proxy(payload, {
        get(target, key) {
          if (key === 'find') {
            return async (args: Parameters<Payload['find']>[0]) => {
              const res = await target.find(args)
              if (args.collection === 'repositories') {
                if (++arrived === 2) release()
                await bothRead
              }
              return res
            }
          }
          const v = Reflect.get(target, key)
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
      return Promise.all([runDiscover(gated, ctx()), runDiscover(gated, ctx())])
    }
    await overlapping()
    expect((await repoDoc('acme/r3')).missedDiscoveries).toBe(2)
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(1)

    const runs = await overlapping()
    expect(runs.flatMap((r) => r.trashed)).toEqual(['103-root'])
    expect((await repoDoc('acme/r3')).missedDiscoveries).toBe(0)
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(2)
  })

  it('resets missedDiscoveries when a repository is found again', async () => {
    await knownRepos({ 1: 2 })
    await discover(search(101, 102, 103, 104))
    expect((await repoDoc('acme/r1')).missedDiscoveries).toBe(0)
  })

  it('trips the guard below half of the known repositories and changes nothing', async () => {
    await knownRepos({ 4: 2 })
    const r = await discover(search(101))
    expect(r).toMatchObject({ guardTripped: true, known: 4, knownSeen: 1, trashed: [] })
    expect(r.warning).toMatch(/saw 1 of 4 known repositories/)
    expect(r.missed).toEqual([])
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(2)
    expect((await repoDoc('acme/r2')).missedDiscoveries).toBe(0)
    expect((await payload.count({ collection: 'plugins', overrideAccess: true })).totalDocs).toBe(4)
  })

  it('trips the guard when GitHub reports incomplete results', async () => {
    await knownRepos()
    const r = await discover({ [searchPage(1)]: searchResult(found(101, 102, 103), { incomplete_results: true }) })
    expect(r.guardTripped).toBe(true)
    expect(r.warning).toMatch(/incomplete/)
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(0)
  })

  it('measures the guard over repositories expected in the topic search only', async () => {
    const m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'maint' } })
    const official = await createRepo(payload, { fullName: 'payloadcms/payload', githubId: 9000 })
    await createPlugin(payload, official.id, { slug: 'official-plugin-seo', source: 'official' })
    for (const [i, name] of ['acme/sub-a', 'acme/sub-b'].entries()) {
      const repo = await createRepo(payload, { fullName: name, githubId: 800 + i })
      await createPlugin(payload, repo.id, { slug: `${800 + i}-root`, source: 'submission' })
      await payload.create({
        collection: 'submissions', overrideAccess: true,
        data: { type: 'listing', url: `https://github.com/${name}`, status: 'approved', submittedBy: m.id },
      })
    }
    for (const i of [1, 2]) {
      const repo = await createRepo(payload, { fullName: `acme/r${i}`, githubId: 100 + i, missedDiscoveries: 2 })
      await createPlugin(payload, repo.id, { slug: `${100 + i}-root` })
    }
    const r = await discover(search()) // empty but "complete"
    expect(r).toMatchObject({ guardTripped: true, known: 2, knownSeen: 0, missed: [], trashed: [] })
    expect(r.warning).toMatch(/saw 0 of 2 known repositories/)
    for (const name of ['acme/r1', 'acme/r2']) expect((await repoDoc(name)).missedDiscoveries).toBe(2)
    expect((await payload.count({ collection: 'plugins', overrideAccess: true })).totalDocs).toBe(5)
  })

  it('trips the guard when the search has more than 1000 results, even with every known repository seen', async () => {
    await knownRepos({ 4: 2 })
    const r = await discover({ [searchPage(1)]: searchResult(found(101, 102, 103), { total_count: 1001 }) })
    expect(r).toMatchObject({ guardTripped: true, trashed: [], missed: [] })
    expect(r.warning).toMatch(/incomplete/)
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(2)
  })

  it('matches search results by GitHub id, not by a full name another repository now holds', async () => {
    await knownRepos()
    // acme/r4 was renamed away; a different repository (id 999) took the name.
    const r = await discover({ [searchPage(1)]: searchResult([...found(101, 102, 103), ghRepo(999, 'acme/r4')]) })
    expect(r.missed).toEqual(['acme/r4'])
    expect((await repoDoc('acme/r4')).missedDiscoveries).toBe(1)
    expect(r.toSync).toContainEqual({ fullName: 'acme/r4', githubId: 999, source: 'topic', discovered: true })
    expect(r.toSync).toContainEqual({ fullName: 'acme/r4', githubId: 104, source: 'topic', discovered: false })
  })

  it('matches seeded rows without a GitHub id by case-insensitive full name', async () => {
    await knownRepos()
    const seeded = await createRepo(payload, { fullName: 'acme/seeded', githubId: null, missedDiscoveries: 2 })
    await createPlugin(payload, seeded.id, { slug: 'seeded-root' })
    const r = await discover({ [searchPage(1)]: searchResult([...found(101, 102, 103, 104), ghRepo(500, 'Acme/Seeded')]) })
    expect(r).toMatchObject({ missed: [], known: 5, knownSeen: 5 })
    expect((await repoDoc('acme/seeded')).missedDiscoveries).toBe(0)
  })

  it('counts a stored official monorepo as found and queues it with its GitHub id', async () => {
    await knownRepos()
    const official = await createRepo(payload, { fullName: 'payloadcms/payload', githubId: 9000, missedDiscoveries: 1 })
    await createPlugin(payload, official.id, { slug: 'official-plugin-seo', source: 'official' })
    const r = await discover(search(101, 102, 103, 104))
    expect(r).toMatchObject({ missed: [], known: 4, knownSeen: 4 })
    expect(r.toSync).toContainEqual({ fullName: 'payloadcms/payload', githubId: 9000, source: 'official', discovered: true })
    expect((await repoDoc('payloadcms/payload')).missedDiscoveries).toBe(0)
  })

  it('queues an approved submission of a stored repository with its GitHub id', async () => {
    const m = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'maint' } })
    await createRepo(payload, { fullName: 'acme/listed', githubId: 600 })
    await payload.create({
      collection: 'submissions', overrideAccess: true,
      data: { type: 'listing', url: 'https://github.com/Acme/Listed', status: 'approved', submittedBy: m.id },
    })
    const r = await discover(search())
    expect(r.toSync).toContainEqual({ fullName: 'Acme/Listed', githubId: 600, source: 'submission', discovered: true })
  })

  it('queues stale-renamed rows that still have a listed plugin by their GitHub id, once', async () => {
    await knownRepos()
    const stale = await createRepo(payload, { fullName: 'acme/old~stale-700', githubId: 700 })
    await createPlugin(payload, stale.id, { slug: '700-root' })
    const gone = await createRepo(payload, { fullName: 'acme/gone~stale-701', githubId: 701 })
    await createPlugin(payload, gone.id, { slug: '701-root', deletedAt: NOW.toISOString() }) // only trashed plugins
    const r = await discover(search(101, 102, 103, 104))
    const staleJobs = r.toSync.filter((s) => s.fullName.includes('~stale-')).sort((a, b) => a.fullName.localeCompare(b.fullName))
    expect(staleJobs).toEqual([{ fullName: 'acme/old~stale-700', githubId: 700, source: 'topic', discovered: false }])
  })

  it('does not queue a stale row twice when the search finds it by id', async () => {
    await knownRepos()
    const stale = await createRepo(payload, { fullName: 'acme/old~stale-700', githubId: 700 })
    await createPlugin(payload, stale.id, { slug: '700-root' })
    const r = await discover({ [searchPage(1)]: searchResult([...found(101, 102, 103, 104), ghRepo(700, 'acme/new-name')]) })
    expect(r.toSync.filter((s) => s.githubId === 700)).toEqual([
      { fullName: 'acme/new-name', githubId: 700, source: 'topic', discovered: true },
    ])
  })
})
