import { describe, expect, it } from 'vitest'
import { getServerURL, isProductionSite } from '@/lib/serverUrl'

describe('getServerURL', () => {
  it('prefers the runtime SERVER_URL', () => {
    expect(getServerURL({ SERVER_URL: 'https://next.payloaddirectory.dev', NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toBe(
      'https://next.payloaddirectory.dev',
    )
  })
  it('falls back to NEXT_PUBLIC_SITE_URL for local dev', () => {
    expect(getServerURL({ NEXT_PUBLIC_SITE_URL: 'http://localhost:3000' })).toBe('http://localhost:3000')
  })
  it('strips a trailing slash and returns empty when unset', () => {
    expect(getServerURL({ SERVER_URL: 'https://payloaddirectory.dev/' })).toBe('https://payloaddirectory.dev')
    expect(getServerURL({})).toBe('')
  })
})

describe('isProductionSite', () => {
  it.each([
    ['https://payloaddirectory.dev', true],
    ['https://payloaddirectory.dev/', true],
    ['https://next.payloaddirectory.dev', false],
    ['http://localhost:3000', false],
    ['https://payloaddirectory.dev.evil.com', false],
    ['', false],
    ['not a url', false],
  ])('%j -> %s', (url, expected) => {
    expect(isProductionSite(url)).toBe(expected)
  })
})
