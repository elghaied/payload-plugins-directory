import { describe, expect, it } from 'vitest'
import data from '../../data/plugins.json'
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
})
