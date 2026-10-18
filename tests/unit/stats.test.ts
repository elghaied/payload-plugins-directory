import { describe, expect, it } from 'vitest'
import { computeStats } from '@/lib/directory/stats'
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
  it('counts v4 and unknown majors', () => {
    const stats = computeStats([{ ...base, payloadMajors: ['3', '4'] }, { ...base, slug: 'b', payloadMajors: ['unknown'] }])
    expect(stats.versions).toEqual({ v1: 0, v2: 0, v3: 1, v4: 1, unknown: 1 })
  })
  it('handles an empty list', () => {
    const stats = computeStats([])
    expect(stats.total).toBe(0)
    expect(stats.avgHealth).toBe(0)
    expect(stats.avgStars).toBe(0)
  })
})
