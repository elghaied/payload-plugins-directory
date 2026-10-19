import { describe, expect, it } from 'vitest'
import { normalizeTagline } from '@/lib/maintainers/branding'

describe('normalizeTagline', () => {
  it('applies NFKC, strips invisible and bidi characters, collapses whitespace and trims', () => {
    expect(normalizeTagline('  Ｆast​ ‮forms\u0007\n  now ')).toBe('Fast forms now')
  })
  it('turns empty or invisible-only input into null', () => {
    expect(normalizeTagline('')).toBeNull()
    expect(normalizeTagline(' ​⁦ ')).toBeNull()
    expect(normalizeTagline(undefined)).toBeNull()
  })
  it('clamps to 120 characters without splitting a surrogate pair', () => {
    expect(normalizeTagline('a'.repeat(300))).toHaveLength(120)
    const out = normalizeTagline('a'.repeat(119) + '\u{1F600}')!
    expect(out).toBe('a'.repeat(119))
  })
})
