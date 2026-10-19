import { describe, expect, it } from 'vitest'
import { computeStats, versionAdoption } from '@/lib/directory/stats'
import type { PluginSummary } from '@/lib/directory/types'

const base: PluginSummary = {
  slug: 'a', name: 'a', description: '', owner: 'o', ownerAvatar: '', url: '', repositoryUrl: 'https://github.com/o/r',
  stars: 0, forks: 0, openIssues: 0, lastUpdate: '', createdAt: '2026-10-01T00:00:00Z', topics: [], isOfficial: false,
  payloadMajors: ['3'], license: 'MIT', isArchived: false,
}

describe('computeStats', () => {
  it('counts monorepo stars once', () => {
    const plugins = [
      { ...base, slug: 'p1', repositoryUrl: 'https://github.com/payloadcms/payload', stars: 45000, isOfficial: true },
      { ...base, slug: 'p2', repositoryUrl: 'https://github.com/payloadcms/payload', stars: 45000, isOfficial: true },
      { ...base, slug: 'p3', repositoryUrl: 'https://github.com/o/r', stars: 10 },
    ]
    const stats = computeStats(plugins)
    expect(stats.totalStars).toBe(45010)
    expect(stats.avgStars).toBe(22505)
    expect(stats.total).toBe(3)
    expect(stats.official).toBe(2)
  })
  it('handles an empty list', () => {
    const stats = computeStats([])
    expect(stats.total).toBe(0)
    expect(stats.avgHealth).toBe(0)
    expect(stats.avgStars).toBe(0)
  })
})

describe('computeStats medianStars', () => {
  it('takes the median over unique repositories, not monorepo-inflated plugins', () => {
    const mono = 'https://github.com/payloadcms/payload'
    const plugins = [
      { ...base, slug: 'm1', repositoryUrl: mono, stars: 100 },
      { ...base, slug: 'm2', repositoryUrl: mono, stars: 100 },
      { ...base, slug: 'm3', repositoryUrl: mono, stars: 100 },
      { ...base, slug: 's1', repositoryUrl: 'https://github.com/o/a', stars: 5 },
      { ...base, slug: 's2', repositoryUrl: 'https://github.com/o/b', stars: 7 },
    ]
    expect(computeStats(plugins).medianStars).toBe(7) // per-plugin median would be 100
  })
})

describe('versionAdoption', () => {
  it('reports plugin share and weekly-download share per major', () => {
    const rows = versionAdoption([
      { ...base, slug: 'a', payloadMajors: ['3', '4'], weeklyDownloads: 300 },
      { ...base, slug: 'b', payloadMajors: ['3'], weeklyDownloads: 100 },
      { ...base, slug: 'c', payloadMajors: ['unknown'] },
      { ...base, slug: 'd', payloadMajors: ['2'], weeklyDownloads: 0 },
    ])
    expect(rows.map((r) => r.major)).toEqual(['4', '3', '2', '1', 'unknown'])
    const v3 = rows.find((r) => r.major === '3')!
    expect(v3).toEqual({ major: '3', label: 'v3', plugins: 2, pluginShare: 0.5, weeklyDownloads: 400, downloadShare: 1 })
    expect(rows.find((r) => r.major === '4')).toMatchObject({ plugins: 1, pluginShare: 0.25, downloadShare: 0.75 })
    expect(rows.find((r) => r.major === 'unknown')).toMatchObject({ label: 'Unknown', plugins: 1, weeklyDownloads: 0 })
  })
  it('handles an empty directory without NaN', () => {
    for (const r of versionAdoption([])) {
      expect(r.pluginShare).toBe(0)
      expect(r.downloadShare).toBe(0)
    }
  })
})
