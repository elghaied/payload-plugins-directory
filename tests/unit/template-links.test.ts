import { describe, expect, it } from 'vitest'
import { canonicalVideoUrl, embedUrlFor, fallbackImageFor, getStartedFor, parseDemoUrl, parseVideoUrl } from '@/lib/templates/links'

describe('parseDemoUrl', () => {
  it('accepts https URLs', () => {
    expect(parseDemoUrl('https://demo.example.com/x')).toBe('https://demo.example.com/x')
  })
  it('rejects hostile or unsuitable URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://demo.example.com', 'https://u:p@demo.example.com',
      'https://localhost:3000', 'https://127.0.0.1', 'https://[::1]/', 'https://intranet', '//demo.example.com', ' ', 'https://' + 'a'.repeat(500) + '.com',
      'https://foo.local', 'https://foo.internal', null, 42])
      expect(parseDemoUrl(bad)).toBeNull()
  })
})

describe('parseVideoUrl', () => {
  it('accepts supported providers', () => {
    expect(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10')).toEqual({ provider: 'youtube', id: 'dQw4w9WgXcQ' })
    expect(parseVideoUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')?.id).toBe('dQw4w9WgXcQ')
    expect(parseVideoUrl('https://vimeo.com/76979871')).toEqual({ provider: 'vimeo', id: '76979871' })
    expect(parseVideoUrl('https://www.loom.com/share/0123456789abcdef0123456789abcdef')?.provider).toBe('loom')
  })
  it('rejects look-alikes and malformed ids', () => {
    for (const bad of ['https://youtube.com.evil.io/watch?v=dQw4w9WgXcQ', 'https://youtu.be/short', 'https://vimeo.com/abc',
      'https://www.loom.com/share/xyz', 'http://youtu.be/dQw4w9WgXcQ', 'https://xn--yutube-wqf.com/watch?v=dQw4w9WgXcQ', undefined])
      expect(parseVideoUrl(bad)).toBeNull()
  })
  it('builds canonical and embed URLs', () => {
    expect(canonicalVideoUrl({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(embedUrlFor({ provider: 'youtube', id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')
    expect(embedUrlFor({ provider: 'vimeo', id: '76979871' })).toBe('https://player.vimeo.com/video/76979871?dnt=1')
    expect(embedUrlFor({ provider: 'loom', id: 'a'.repeat(32) })).toBe(`https://www.loom.com/embed/${'a'.repeat(32)}`)
    const ref = parseVideoUrl(canonicalVideoUrl({ provider: 'vimeo', id: '76979871' }))
    expect(ref).toEqual({ provider: 'vimeo', id: '76979871' })
  })
})

describe('getStartedFor / fallbackImageFor', () => {
  it('chooses the right command or link', () => {
    expect(getStartedFor({ isOfficial: true, slug: 'website', fullName: 'payloadcms/payload', path: 'templates/website', isTemplateRepo: false }))
      .toEqual({ kind: 'command', value: 'npx create-payload-app -t website' })
    expect(getStartedFor({ isOfficial: false, slug: '1-root', fullName: 'a/b', path: null, isTemplateRepo: true }))
      .toEqual({ kind: 'link', value: 'https://github.com/a/b/generate' })
    expect(getStartedFor({ isOfficial: false, slug: '1-root', fullName: 'a/b', path: null, isTemplateRepo: false }))
      .toEqual({ kind: 'command', value: 'git clone https://github.com/a/b.git' })
    expect(getStartedFor({ isOfficial: false, slug: '1-site', fullName: 'a/b', path: 'apps/site', isTemplateRepo: false }).value)
      .toBe('npx giget@latest gh:a/b/apps/site my-app')
  })
  it('only trusts allow-listed https fallback images', () => {
    expect(fallbackImageFor({ fallbackImageUrl: null, fullName: 'a/b' })).toBe('https://opengraph.githubassets.com/1/a/b')
    expect(fallbackImageFor({ fallbackImageUrl: 'https://evil.example/x.png', fullName: 'a/b' })).toBe('https://opengraph.githubassets.com/1/a/b')
    expect(fallbackImageFor({ fallbackImageUrl: 'http://raw.githubusercontent.com/a/b/x.png', fullName: 'a/b' })).toBe('https://opengraph.githubassets.com/1/a/b')
    expect(fallbackImageFor({ fallbackImageUrl: 'https://raw.githubusercontent.com/a/b/x.png', fullName: 'a/b' })).toBe('https://raw.githubusercontent.com/a/b/x.png')
  })
})
