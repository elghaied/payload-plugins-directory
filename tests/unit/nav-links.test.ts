import { describe, expect, it } from 'vitest'
import { isActiveLink, NAV_LINKS } from '@/components/navLinks'

describe('navigation links', () => {
  it('includes Trending between Home and Stats', () => {
    expect(NAV_LINKS.map((l) => l.href)).toEqual(['/', '/trending', '/stats', '/about'])
  })
  it('marks only the matching section active', () => {
    expect(isActiveLink('/', '/')).toBe(true)
    expect(isActiveLink('/', '/trending')).toBe(false)
    expect(isActiveLink('/trending', '/trending')).toBe(true)
    expect(isActiveLink('/stats', '/statsx')).toBe(false)
    expect(isActiveLink('/stats', null)).toBe(false)
  })
})
