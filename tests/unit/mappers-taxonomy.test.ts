import { describe, expect, it } from 'vitest'
import { categoryOf, toDetail, toSummary } from '@/lib/directory/mappers'
import { pluginTagline } from '@/lib/directory/tagline'

const repo = {
  id: 1, fullName: 'acme/s3', owner: 'acme', ownerAvatar: 'https://a/1', url: 'https://github.com/acme/s3', stars: 5, forks: 1,
  openIssues: 0, license: 'MIT', isArchived: false, pushedAt: '2026-08-01T00:00:00.000Z', githubCreatedAt: '2025-01-01T00:00:00.000Z',
  topics: [], isMonorepo: false,
}
const doc = {
  id: 7, slug: 's3', name: 'payload s3', repository: repo, url: 'https://github.com/acme/s3', isOfficial: false, source: 'topic',
  description: 'Author text', readme: '# S3\n\nFull readme.', payloadMajors: ['3'], visibility: 'listed',
  category: { id: 2, slug: 'cloud-storage', title: 'Cloud storage', _h_slugPath: 'storage-media/cloud-storage' },
  _h_tags: [{ id: 1, slug: 's3', title: 'Amazon S3' }, 9],
  ai: { tagline: 'AI tagline', summary: 'AI summary.', features: ['F1'], useCases: ['U1'] },
  locks: { summary: false },
}

describe('pluginTagline', () => {
  it('prefers the maintainer tagline, then the AI tagline, then the author description', () => {
    expect(pluginTagline({ customTagline: 'Mine', ai: { tagline: 'AI' }, description: 'Author' })).toBe('Mine')
    expect(pluginTagline({ customTagline: ' ', ai: { tagline: 'AI' }, description: 'Author' })).toBe('AI')
    expect(pluginTagline({ ai: {}, description: 'Author' })).toBe('Author')
    expect(pluginTagline({})).toBe('')
  })
})

describe('taxonomy on summaries and details', () => {
  it('puts the display tagline, category path and tag slugs on the summary', () => {
    expect(toSummary(doc as never)).toMatchObject({ description: 'AI tagline', categoryPath: 'storage-media/cloud-storage', tags: ['s3'] })
  })
  it('omits empty taxonomy keys so uncategorized plugins do not grow the home payload', () => {
    const s = toSummary({ ...doc, category: null, _h_tags: [], ai: {} } as never)
    expect(s).not.toHaveProperty('categoryPath')
    expect(s).not.toHaveProperty('tags')
    expect(s.description).toBe('Author text')
  })
  it('keeps the author description, full README, AI overview, category and tags on the detail', () => {
    const d = toDetail(doc as never)
    expect(d).toMatchObject({
      description: 'AI tagline',
      authorDescription: 'Author text',
      readmeFull: '# S3\n\nFull readme.',
      ai: { summary: 'AI summary.', features: ['F1'], useCases: ['U1'], generated: true },
      category: { slug: 'cloud-storage', title: 'Cloud storage', path: 'storage-media/cloud-storage' },
      tagList: [{ slug: 's3', title: 'Amazon S3' }],
    })
  })
  it('marks admin-locked overview text as not generated, and has no overview without AI text', () => {
    expect(toDetail({ ...doc, locks: { summary: true, features: true, useCases: true } } as never).ai?.generated).toBe(false)
    expect(toDetail({ ...doc, ai: {} } as never)).not.toHaveProperty('ai')
  })
})

describe('safety', () => {
  it('categoryOf throws when the category was loaded without _h_slugPath', () => {
    expect(() => categoryOf({ ...doc, category: { id: 2, slug: 'cloud-storage', title: 'Cloud storage' } } as never)).toThrow(/_h_slugPath/)
    expect(() => toSummary({ ...doc, category: { id: 2, slug: 'x', title: 'X' } } as never)).toThrow(/_h_slugPath/)
  })
  it('never leaks admin-only fields to public summaries or details', () => {
    const full = {
      ...doc,
      ai: { tagline: 'T', summary: 'S', features: ['F'], useCases: ['U'], failure: 'boom', failedKey: 'k', failedAt: 'x', promptHash: 'h' },
      syncTrashReason: 'gone', locks: { summary: true },
    }
    const keysOf = (v: unknown): string[] =>
      Array.isArray(v) ? v.flatMap(keysOf) : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []
    for (const out of [toSummary(full as never), toDetail(full as never)]) {
      const keys = keysOf(out)
      for (const k of ['failure', 'failedKey', 'failedAt', 'promptHash', 'syncTrashReason', 'locks']) expect(keys).not.toContain(k)
      expect(JSON.stringify(out)).not.toContain('boom')
    }
  })
})

describe('final fix C2: detail fields', () => {
  it('drops the sync placeholder author description and exposes the maintainer tagline', () => {
    expect(toDetail({ ...doc, description: 'No description available' } as never).authorDescription).toBe('')
    expect(toDetail({ ...doc, description: '  ' } as never).authorDescription).toBe('')
    expect(toDetail({ ...doc, customTagline: ' Mine ' } as never).customTagline).toBe('Mine')
    expect(toDetail(doc as never)).not.toHaveProperty('customTagline')
  })
  it('notes "generated" only when the summary itself is machine-written', () => {
    expect(toDetail({ ...doc, locks: { summary: true } } as never).ai?.generated).toBe(false)
    expect(toDetail({ ...doc, ai: { ...doc.ai, summary: '' } } as never).ai?.generated).toBe(false)
    expect(toDetail(doc as never).ai?.generated).toBe(true)
  })
})
