import { describe, expect, it } from 'vitest'
import { safeAvatarUrl, signInHref } from '@/lib/auth/avatar'

describe('safeAvatarUrl', () => {
  it('accepts the GitHub avatar CDN over https', () => {
    expect(safeAvatarUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe('https://avatars.githubusercontent.com/u/1?v=4')
  })
  it.each([
    'http://avatars.githubusercontent.com/u/1',
    'https://evil.test/a.png',
    'https://avatars.githubusercontent.com.evil.test/a.png',
    'https://user@avatars.githubusercontent.com/a.png',
    'https://avatars.githubusercontent.com:8443/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '',
    null,
    42,
  ])('rejects %s', (v) => expect(safeAvatarUrl(v)).toBeNull())
})

describe('signInHref', () => {
  it('returns to the current path', () => expect(signInHref('/plugins/seo')).toBe('/auth/github?returnTo=%2Fplugins%2Fseo'))
  it('omits returnTo for unsafe or auth paths', () => {
    expect(signInHref('//evil')).toBe('/auth/github')
    expect(signInHref('/auth/error')).toBe('/auth/github')
    expect(signInHref(null)).toBe('/auth/github')
  })
})
