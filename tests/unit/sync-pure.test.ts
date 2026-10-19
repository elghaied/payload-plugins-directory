import { describe, expect, it } from 'vitest'
import { isValidCacheTag, revalidationTagsFor } from '@/lib/cacheTags'
import { readmePreview } from '@/lib/directory/readme'
import { aliasTagIds, mergeTagIds } from '@/sync/aliasTags'
import { computeContentHash } from '@/sync/contentHash'
import { computeHealthScore, healthInputFrom, npmForHealth, scoreFor } from '@/sync/health'
import {
  getPayloadVersion, getWorkspaceDirs, isLikelyPlugin, isMonorepo, isValidPackageName,
  normalizeGitHubUrl, parseGitHubFullName, parseNpmPackageName,
} from '@/sync/packages'

describe('package helpers (ported from scripts/fetch-plugins.ts)', () => {
  it('validates npm package names', () => {
    expect(isValidPackageName('payload-plugin-seo')).toBe(true)
    expect(isValidPackageName('@acme/payload-seo')).toBe(true)
    expect(isValidPackageName('dev')).toBe(false)
    expect(isValidPackageName('Has Space')).toBe(false)
    expect(isValidPackageName(undefined)).toBe(false)
  })
  it('reads the payload range from peer, then regular, then dev dependencies', () => {
    expect(getPayloadVersion({ peerDependencies: { payload: '^3.0.0' }, dependencies: { payload: '^2.0.0' } })).toBe('^3.0.0')
    expect(getPayloadVersion({ devDependencies: { payload: '^3.1.0' } })).toBe('^3.1.0')
    expect(getPayloadVersion({})).toBeNull()
  })
  it('ignores non-string and non-array workspace declarations', () => {
    expect(getWorkspaceDirs({ workspaces: [1, 'packages/*'] as unknown as string[] })).toEqual(['packages'])
    expect(getWorkspaceDirs({ workspaces: { packages: 'packages/*' } as unknown as { packages: string[] } })).toEqual([])
    expect(isMonorepo({ workspaces: { packages: 'packages/*' } as unknown as { packages: string[] } })).toBe(false)
  })

  it('detects workspaces and their top-level directories', () => {
    expect(isMonorepo({ workspaces: ['packages/*'] })).toBe(true)
    expect(isMonorepo({ workspaces: { packages: [] } })).toBe(false)
    expect(getWorkspaceDirs({ workspaces: { packages: ['packages/*', 'plugins/*', 'packages/nested/*', '*'] } })).toEqual(['packages', 'plugins'])
  })
  it('accepts a sub-package as a plugin only with a runtime payload dependency', () => {
    expect(isLikelyPlugin('seo', { peerDependencies: { payload: '^3' } })).toBe(true)
    expect(isLikelyPlugin('seo', { devDependencies: { payload: '^3' } })).toBe(false)
    expect(isLikelyPlugin('seo', { private: true, peerDependencies: { payload: '^3' } })).toBe(false)
    expect(isLikelyPlugin('examples', { dependencies: { payload: '^3' } })).toBe(false)
  })
  it('normalizes GitHub repository URLs from npm metadata', () => {
    expect(normalizeGitHubUrl('git+https://github.com/Acme/Payload-SEO.git')).toBe('acme/payload-seo')
    expect(normalizeGitHubUrl('git@github.com:acme/seo.git')).toBe('acme/seo')
    expect(normalizeGitHubUrl('github:acme/seo')).toBe('acme/seo')
    expect(normalizeGitHubUrl('https://gitlab.com/acme/seo')).toBeNull()
    expect(normalizeGitHubUrl(null)).toBeNull()
  })
  it('parses submission URLs', () => {
    expect(parseGitHubFullName('https://github.com/Acme/payload-seo')).toBe('Acme/payload-seo')
    expect(parseGitHubFullName('https://github.com/acme/mono/tree/main/packages/seo')).toBe('acme/mono')
    expect(parseGitHubFullName('https://github.com/acme/seo.git')).toBe('acme/seo')
    expect(parseGitHubFullName('https://www.npmjs.com/package/seo')).toBeNull()
    expect(parseNpmPackageName('https://www.npmjs.com/package/@acme/payload-seo')).toBe('@acme/payload-seo')
    expect(parseNpmPackageName('https://npmjs.com/package/payload-seo?activeTab=readme')).toBe('payload-seo')
    expect(parseNpmPackageName('https://github.com/acme/seo')).toBeNull()
  })
})

describe('computeHealthScore (legacy formula)', () => {
  const now = new Date('2026-10-19T00:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString()
  const base = { isArchived: false, pushedAt: daysAgo(10), stars: 1000, openIssues: 10, license: 'MIT', isOfficial: false }

  it('scores archived repositories 0', () => {
    expect(computeHealthScore({ ...base, isArchived: true }, now)).toBe(0)
  })
  it('caps a perfect official plugin at 100', () => {
    const npm = { weeklyDownloads: 10_000, lastPublish: daysAgo(10), dependencyCount: 2, unpackedSize: 10 * 1024 }
    expect(computeHealthScore({ ...base, isOfficial: true, npm }, now)).toBe(100)
  })
  it('scores a small repository without npm data', () => {
    // 10 (pushed 100 days ago) + 5 (10 stars) + 4 (issue ratio 0.1) + 0 (no license)
    expect(computeHealthScore({ ...base, pushedAt: daysAgo(100), stars: 10, openIssues: 1, license: null }, now)).toBe(19)
  })
  it('scores npm signals', () => {
    // 0 (pushed 400 days ago) + 10 (no stars, no issues) + 5 (license) + 10 (100/week) + 4 (published 200 days ago) + 4 (9 deps) + 1 (300 KB)
    const npm = { weeklyDownloads: 100, lastPublish: daysAgo(200), dependencyCount: 9, unpackedSize: 300 * 1024 }
    expect(computeHealthScore({ ...base, pushedAt: daysAgo(400), stars: 0, openIssues: 0, npm }, now)).toBe(34)
  })
  it('builds input from stored documents', () => {
    expect(npmForHealth({ weeklyDownloads: 5, latestVersion: null })).toBeUndefined()
    expect(npmForHealth({ weeklyDownloads: 5, latestVersion: '1.0.0', lastPublish: null, dependencyCount: null, unpackedSize: null }))
      .toEqual({ weeklyDownloads: 5, lastPublish: null, dependencyCount: 0, unpackedSize: null })
    const repo = { stars: 100, openIssues: 50, isArchived: null, pushedAt: null, license: null }
    expect(healthInputFrom(repo, { isOfficial: true, ignoreIssues: true }).openIssues).toBe(0)
    expect(healthInputFrom(repo, { isOfficial: false }).openIssues).toBe(50)
  })
  it('scoreFor composes input building and scoring', () => {
    const repo = { isArchived: false, pushedAt: daysAgo(10), stars: 1000, openIssues: 10, license: 'MIT' }
    const npm = { weeklyDownloads: 10_000, latestVersion: '1.0.0', lastPublish: daysAgo(10), dependencyCount: 2, unpackedSize: 10 * 1024 }
    expect(scoreFor(repo, { isOfficial: true, npm }, now)).toBe(100)
    expect(scoreFor({ ...repo, isArchived: true }, {}, now)).toBe(0)
  })
})

describe('computeContentHash', () => {
  const base = { readme: '# A', packageJsonText: '{}', description: 'x' }
  it('is a stable sha256 hex digest', () => {
    expect(computeContentHash(base)).toMatch(/^[0-9a-f]{64}$/)
    expect(computeContentHash({ ...base })).toBe(computeContentHash(base))
  })
  it('changes with any input and treats missing values as empty', () => {
    const h = computeContentHash(base)
    expect(computeContentHash({ ...base, readme: '# B' })).not.toBe(h)
    expect(computeContentHash({ ...base, packageJsonText: '{"a":1}' })).not.toBe(h)
    expect(computeContentHash({ ...base, description: 'y' })).not.toBe(h)
    expect(computeContentHash({ readme: undefined, packageJsonText: '', description: null })).toBe(
      computeContentHash({ readme: '', packageJsonText: '', description: '' }),
    )
  })
})

describe('alias tags', () => {
  const tags = [{ id: 1, aliases: ['seo', 'Search-Engine'] }, { id: 2, aliases: ['auth'] }, { id: 3, aliases: null }]
  it('maps topics and keywords to tag ids case-insensitively', () => {
    expect(aliasTagIds(['payload-plugin', 'SEO', 'search-engine'], tags)).toEqual([1])
  })
  it('merges with existing tags without dropping any', () => {
    expect(mergeTagIds([5, { id: 2 }], [1, 2])).toEqual([1, 2, 5])
    expect(mergeTagIds(null, [])).toEqual([])
  })
})

describe('cache tags', () => {
  it('validates the tag vocabulary', () => {
    for (const t of ['plugins', 'home', 'stats', 'trending', 'plugin:684372049-better-localized-fields', 'plugin:official-plugin-seo', 'category:seo']) {
      expect(isValidCacheTag(t)).toBe(true)
    }
    for (const t of ['', 'plugin:', 'plugin:../x', 'Plugins', 'user:1', 42]) expect(isValidCacheTag(t)).toBe(false)
  })
  it('builds the list tag plus sorted per-plugin tags, empty when nothing changed', () => {
    expect(revalidationTagsFor(['b', 'a', 'b'])).toEqual(['plugins', 'plugin:a', 'plugin:b'])
    expect(revalidationTagsFor([])).toEqual([])
  })
})

describe('readmePreview (legacy detail-page preview)', () => {
  it('returns short readmes unchanged', () => {
    expect(readmePreview('# Title\n\nShort.')).toBe('# Title\n\nShort.')
  })
  it('cuts at the last sentence or paragraph break after 200 characters', () => {
    expect(readmePreview(`${'a'.repeat(250)}. ${'b'.repeat(400)}`)).toBe(`${'a'.repeat(250)}.`)
  })
  it('hard-cuts at 500 characters without a late break', () => {
    expect(readmePreview('x'.repeat(800))).toBe('x'.repeat(500))
  })
  it('is undefined for empty input', () => {
    expect(readmePreview(null)).toBeUndefined()
    expect(readmePreview('')).toBeUndefined()
  })
})
