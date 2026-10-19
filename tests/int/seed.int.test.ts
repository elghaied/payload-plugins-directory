import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import fixture from '../fixtures/legacy-plugins.json'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'
import { seedCommand, seedDirectory } from '@/cli/seed'

let payload: Payload
const input = mapLegacy(fixture as LegacyPluginsData, ['684372049-translator'])

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('seedDirectory', () => {
  it('creates repositories and plugins', async () => {
    const result = await seedDirectory(payload, input)
    expect(result).toEqual({ repositoriesCreated: 3, repositoriesUpdated: 0, pluginsCreated: 4, pluginsUpdated: 0 })
    const plugin = await payload.find({
      collection: 'plugins',
      overrideAccess: true,
      where: { slug: { equals: '684372049-better-localized-fields' } },
      depth: 1,
    })
    expect((plugin.docs[0].repository as { fullName: string }).fullName).toBe('r1tsuu/payload-enchants')
  })

  it('is idempotent on re-run', async () => {
    const result = await seedDirectory(payload, input)
    expect(result).toEqual({ repositoriesCreated: 0, repositoriesUpdated: 3, pluginsCreated: 0, pluginsUpdated: 4 })
    const count = await payload.count({ collection: 'plugins', overrideAccess: true })
    expect(count.totalDocs).toBe(4)
  })

  it('keeps a trashed plugin trashed on re-run, without creating a duplicate', async () => {
    const slug = '684372049-better-localized-fields'
    const before = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: slug } } })
    const id = before.docs[0].id
    await payload.update({ collection: 'plugins', id, overrideAccess: true, data: { deletedAt: new Date().toISOString() } })

    const result = await seedDirectory(payload, input)
    expect(result).toEqual({ repositoriesCreated: 0, repositoriesUpdated: 3, pluginsCreated: 0, pluginsUpdated: 4 })

    const matches = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: slug } } })
    expect(matches.docs.map((d) => d.id)).toEqual([id])
    expect(matches.docs[0].deletedAt).toEqual(expect.any(String))
    const all = await payload.count({ collection: 'plugins', overrideAccess: true, trash: true })
    expect(all.totalDocs).toBe(4)
  })

  it('refreshes existing repositories on re-seed', async () => {
    const target = input.repositories[0]
    const stars = target.stars + 100
    const changed = {
      ...input,
      repositories: input.repositories.map((r) => (r.fullName === target.fullName ? { ...r, stars } : r)),
    }
    const result = await seedDirectory(payload, changed)
    expect(result.repositoriesUpdated).toBe(3)
    const repo = await payload.find({
      collection: 'repositories',
      overrideAccess: true,
      where: { fullName: { equals: target.fullName } },
    })
    expect(repo.docs[0].stars).toBe(stars)
  })

  it('preserves admin-set visibility on re-seed', async () => {
    const slug = '684372049-better-localized-fields'
    const find = () => payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: slug } } })
    const doc = (await find()).docs[0]
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, trash: true, data: { visibility: 'hidden' } })
    await seedDirectory(payload, input)
    expect((await find()).docs[0].visibility).toBe('hidden')
    // restore for later tests
    await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, trash: true, data: { visibility: 'listed' } })
  })

  it('hides an existing listed plugin newly added to the blocklist', async () => {
    const slug = '684372049-better-localized-fields'
    const find = () => payload.find({ collection: 'plugins', overrideAccess: true, trash: true, where: { slug: { equals: slug } } })
    expect((await find()).docs[0].visibility).toBe('listed')
    await seedDirectory(payload, mapLegacy(fixture as LegacyPluginsData, ['684372049-translator', slug]))
    expect((await find()).docs[0].visibility).toBe('hidden')
  })

  it('the CLI command imports the file given on the command line and queues a discover run', async () => {
    await resetDatabase(payload)
    await seedCommand.handler({ args: { file: 'tests/fixtures/legacy-plugins.json' }, getPayload: async () => payload } as never)
    const plugins = await payload.count({ collection: 'plugins', overrideAccess: true, trash: true })
    expect(plugins.totalDocs).toBe(4)
    const repos = await payload.count({ collection: 'repositories', overrideAccess: true })
    expect(repos.totalDocs).toBe(3)
    const jobs = await payload.find({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'discover' } } })
    expect(jobs.totalDocs).toBe(1)
  })

  it('CLI hides the built-in legacy blocklist ids even when no --blocklist is given', async () => {
    await resetDatabase(payload)
    const renamed = JSON.stringify(fixture).replaceAll('829724738-root', '979457999-root')
    const file = path.join(await mkdtemp(path.join(tmpdir(), 'seed-')), 'plugins.json')
    await writeFile(file, renamed)
    await seedCommand.handler({ args: { file }, getPayload: async () => payload } as never)
    const hidden = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '979457999-root' } } })
    expect(hidden.docs[0].visibility).toBe('hidden')
    const listed = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '684372049-translator' } } })
    expect(listed.docs[0].visibility).toBe('listed')
  })
})
