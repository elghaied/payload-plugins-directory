import { describe, expect, it } from 'vitest'
import { toDetail, toSummary } from '@/lib/directory/mappers'

const repo = {
  id: 1, fullName: 'r1tsuu/payload-enchants', owner: 'r1tsuu', ownerAvatar: 'https://a/2',
  url: 'https://github.com/r1tsuu/payload-enchants', stars: 300, forks: 10, openIssues: 2,
  license: 'MIT', isArchived: false, pushedAt: '2026-08-01T00:00:00.000Z', githubCreatedAt: '2023-01-01T00:00:00.000Z',
  topics: ['payload-plugin'], isMonorepo: true,
}
const doc = {
  id: 7, slug: '684372049-translator', name: 'translator', packageName: '@payload-enchants/translator',
  repository: repo, path: 'packages/translator', url: 'https://github.com/r1tsuu/payload-enchants/tree/master/packages/translator',
  isOfficial: false, source: 'topic', description: 'Translate', readme: 'Long readme',
  payloadVersionRange: '^3.0.0', payloadMajors: ['3'], npm: { weeklyDownloads: 12, latestVersion: '1.2.0', unpackedSize: 5000 },
  healthScore: 60, visibility: 'listed',
}

describe('toSummary', () => {
  const s = toSummary(doc as never)
  it('takes repo facts from the repository', () => {
    expect(s).toMatchObject({ owner: 'r1tsuu', stars: 300, repositoryUrl: 'https://github.com/r1tsuu/payload-enchants', collection: 'payload-enchants' })
  })
  it('never includes the readme', () => {
    expect(s).not.toHaveProperty('readme')
  })
  it('flattens npm fields', () => {
    expect(s).toMatchObject({ weeklyDownloads: 12, latestVersion: '1.2.0', unpackedSize: 5000 })
  })
  it('defaults payloadMajors to unknown when empty', () => {
    expect(toSummary({ ...doc, payloadMajors: [] } as never).payloadMajors).toEqual(['unknown'])
  })
  it('omits collection for single-package repos', () => {
    expect(toSummary({ ...doc, repository: { ...repo, isMonorepo: false } } as never).collection).toBeUndefined()
  })
})

describe('toDetail', () => {
  it('carries readmeTruncated through to the detail', () => {
    expect(toDetail({ ...doc, readmeTruncated: true } as never).readmeTruncated).toBe(true)
    expect(toDetail(doc as never).readmeTruncated).toBe(false)
  })

  it('includes readme and version range', () => {
    expect(toDetail(doc as never)).toMatchObject({ readme: 'Long readme', payloadVersionRange: '^3.0.0' })
  })
})

describe('toDetail maintainer branding', () => {
  it('exposes customTagline and the logo URL', () => {
    const d = toDetail({ ...doc, customTagline: 'Fast forms', logo: { id: 3, url: '/api/media/file/x-logo.png', alt: 'x' } } as never)
    expect(d).toMatchObject({ customTagline: 'Fast forms', logoUrl: '/api/media/file/x-logo.png' })
  })
  it('omits them when unset or unpopulated', () => {
    const d = toDetail({ ...doc, customTagline: null, logo: 3 } as never)
    expect(d.customTagline).toBeUndefined()
    expect(d.logoUrl).toBeUndefined()
  })
  it('keeps them out of the slim summary', () => {
    const s = toSummary({ ...doc, customTagline: 'x', logo: { id: 3, url: '/u' } } as never)
    expect(s).not.toHaveProperty('customTagline')
    expect(s).not.toHaveProperty('logoUrl')
  })
})
