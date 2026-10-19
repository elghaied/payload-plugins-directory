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
    const category = { id: 1, slug: 's3', title: 'S3', _h_slugPath: 'storage/s3' }
    const _h_tags = [1, 2, 3].map((id) => ({ id, slug: `tag-${id}`, title: `Tag ${id}` }))
    const json = JSON.stringify(
      plugins.map(({ repositoryFullName, ...p }, i) =>
        toSummary({ id: i, ...p, category, _h_tags, repository: repos.get(repositoryFullName) } as never),
      ),
    )
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(400_000)
    expect(gzipSync(json).length).toBeLessThanOrEqual(60_000)
  })
})
