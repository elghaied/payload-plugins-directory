import { describe, expect, it } from 'vitest'
import { toTemplateDetail, toTemplateSummary } from '@/lib/templates/mappers'

const repo = {
  id: 1, fullName: 'a/b', owner: 'a', ownerAvatar: 'https://a/2', url: 'https://github.com/a/b', stars: 5000,
  pushedAt: '2026-08-01T00:00:00.000Z', githubCreatedAt: '2023-01-01T00:00:00.000Z', license: 'MIT',
}
const base = {
  id: 7, slug: '5-root', name: 'Cool', repository: repo, path: null, url: 'https://github.com/a/b', isOfficial: false,
  source: 'submission', description: 'Author words', payloadMajors: ['3'], stackDetected: 'nextjs', isTemplateRepo: true, visibility: 'listed',
}
const media = { id: 3, alt: 'Home page', url: '/media/full.webp', width: 1000, height: 600, variants: { card: { url: '/media/card.webp' }, gallery: { url: '/media/gallery.webp', width: 1600, height: 900 } } }

describe('toTemplateSummary', () => {
  it('gives stars null for official templates', () => {
    const s = toTemplateSummary({ ...base, slug: 'website', isOfficial: true, source: 'official' } as never)
    expect(s.stars).toBeNull()
    expect(s.isOfficial).toBe(true)
  })
  it('uses the card variant of the first screenshot', () => {
    const s = toTemplateSummary({ ...base, screenshots: [media] } as never)
    expect(s.image.local).toBe(true)
    expect(s.image.src).toBe('/media/card.webp')
  })
  it('falls back to media.url when there is no card variant', () => {
    const s = toTemplateSummary({ ...base, screenshots: [{ id: 4, alt: 'x', url: '/media/plain.png' }] } as never)
    expect(s.image).toMatchObject({ src: '/media/plain.png', local: true })
  })
  it('uses fallbackImageFor without a screenshot', () => {
    expect(toTemplateSummary(base as never).image).toEqual({ src: 'https://opengraph.githubassets.com/1/a/b', local: false })
    const withStored = toTemplateSummary({ ...base, fallbackImageUrl: 'https://raw.githubusercontent.com/a/b/main/s.png' } as never)
    expect(withStored.image).toEqual({ src: 'https://raw.githubusercontent.com/a/b/main/s.png', local: false })
  })
  it('never shows workspace:* as a version range', () => {
    expect(toTemplateDetail({ ...base, payloadVersionRange: 'workspace:*' } as never).payloadVersionRange).toBeNull()
    expect(toTemplateDetail({ ...base, payloadVersionRange: '4.0.0-beta.3' } as never).payloadVersionRange).toBe('4.0.0-beta.3')
  })
  it('ignores an unpopulated screenshot id', () => {
    expect(toTemplateSummary({ ...base, screenshots: [3] } as never).image.local).toBe(false)
  })
  it('follows the tagline precedence and lastUpdate fallback', () => {
    expect(toTemplateSummary(base as never)).toMatchObject({ tagline: 'Author words', lastUpdate: repo.pushedAt, createdAt: repo.githubCreatedAt })
    expect(toTemplateSummary({ ...base, ai: { tagline: 'AI' } } as never).tagline).toBe('AI')
    expect(toTemplateSummary({ ...base, ai: { tagline: 'AI' }, customTagline: 'Mine' } as never).tagline).toBe('Mine')
    expect(toTemplateSummary({ ...base, lastUpdatedAt: '2026-09-01T00:00:00.000Z' } as never).lastUpdate).toBe('2026-09-01T00:00:00.000Z')
  })
  it('lets stackOverride win and defaults majors to unknown', () => {
    expect(toTemplateSummary({ ...base, stackOverride: 'tanstack-start' } as never).stack).toBe('tanstack-start')
    expect(toTemplateSummary({ ...base, payloadMajors: [] } as never).payloadMajors).toEqual(['unknown'])
  })
  it('passes through a valid demo URL only', () => {
    expect(toTemplateSummary({ ...base, demoUrl: 'https://demo.example.com/' } as never).demoUrl).toBe('https://demo.example.com/')
    expect(toTemplateSummary({ ...base, demoUrl: 'javascript:alert(1)' } as never)).not.toHaveProperty('demoUrl')
  })
  it('never carries the readme', () => {
    expect(toTemplateSummary({ ...base, readme: 'long' } as never)).not.toHaveProperty('readme')
  })
})

describe('toTemplateDetail', () => {
  it('maps screenshots, video, get-started and ai', () => {
    const d = toTemplateDetail({
      ...base, screenshots: [media], videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', license: 'MIT',
      ai: { summary: 'Sum', features: ['f'], useCases: ['u'] }, readme: 'Readme body',
    } as never)
    expect(d.screenshots).toEqual([{ full: '/media/gallery.webp', card: '/media/card.webp', alt: 'Home page', width: 1600, height: 900 }])
    expect(d.video).toEqual({ provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    expect(d.getStarted).toEqual({ kind: 'link', value: 'https://github.com/a/b/generate' })
    expect(d.ai).toEqual({ summary: 'Sum', features: ['f'], goodFor: ['u'], generated: true })
    expect(d).toMatchObject({ fullName: 'a/b', license: 'MIT', path: null, authorDescription: 'Author words', readmeFull: 'Readme body' })
  })
  it('drops a hostile video URL and omits ai when empty', () => {
    const d = toTemplateDetail({ ...base, videoUrl: 'https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ' } as never)
    expect(d.video).toBeUndefined()
    expect(d.ai).toBeUndefined()
    expect(d.tagList).toEqual([])
  })
  it('uses the official get-started command', () => {
    expect(toTemplateDetail({ ...base, slug: 'website', isOfficial: true } as never).getStarted).toEqual({ kind: 'command', value: 'npx create-payload-app -t website' })
  })
})
