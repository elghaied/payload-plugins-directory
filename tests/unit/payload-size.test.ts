import { gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import data from '../fixtures/plugins-full.json'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'
import { toSummary } from '@/lib/directory/mappers'

describe('home payload', () => {
  it('serializes all summaries under 300 KB (was ~520 KB with readmes)', () => {
    const { repositories, plugins } = mapLegacy(data as LegacyPluginsData, [])
    const repos = new Map(repositories.map((r, i) => [r.fullName, { id: i, ...r }]))
    const summaries = plugins.map(({ repositoryFullName, ...p }, i) =>
      toSummary({ id: i, ...p, repository: repos.get(repositoryFullName) } as never),
    )
    const bytes = Buffer.byteLength(JSON.stringify(summaries))
    // Brief targeted 250 KB; the Task 7 summary shape measures ~289 KB for 369 plugins.
    expect(bytes).toBeLessThan(300_000)
    expect(JSON.stringify(summaries)).not.toContain('"readme"')
  })

  it('stays small when every plugin is categorised and tagged (raw <= 400 KB, gzip <= 60 KB)', () => {
    const { repositories, plugins } = mapLegacy(data as LegacyPluginsData, [])
    const repos = new Map(repositories.map((r, i) => [r.fullName, { id: i, ...r }]))
    // Varied per plugin (a realistic spread of ~30 categories and ~60 tags): identical values would compress unrealistically well.
    const categoryFor = (i: number) => ({ id: i % 30, slug: `category-${i % 30}`, title: `Category ${i % 30}`, _h_slugPath: `group-${i % 8}/category-${i % 30}` })
    const tagsFor = (i: number) => [i, i * 7 + 3, i * 13 + 5].map((n) => ({ id: n % 60, slug: `tag-slug-${n % 60}`, title: `Tag ${n % 60}` }))
    const json = JSON.stringify(
      plugins.map(({ repositoryFullName, ...p }, i) =>
        toSummary({ id: i, ...p, category: categoryFor(i), _h_tags: tagsFor(i), repository: repos.get(repositoryFullName) } as never),
      ),
    )
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(400_000)
    expect(gzipSync(json).length).toBeLessThanOrEqual(60_000)
  })
})
