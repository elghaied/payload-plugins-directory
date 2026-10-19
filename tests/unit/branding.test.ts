import { describe, expect, it } from 'vitest'
import { normalizeTagline, validateTagline } from '@/lib/maintainers/branding'

// Invisible characters are always written as escapes, never as literals.
describe('normalizeTagline', () => {
  it('applies NFKC, strips invisible and bidi characters, collapses whitespace and trims', () => {
    expect(normalizeTagline('  \uff26ast\u200b \u202eforms\u0007\n  now ')).toBe('Fast forms now')
  })
  it('strips every listed invisible character', () => {
    const all = [0xad, 0x61c, 0x200b, 0x200c, 0x200e, 0x200f, 0x202a, 0x202e, 0x2060, 0x2064, 0x2066, 0x2069, 0xfeff]
    for (const code of all) expect(normalizeTagline(`a${String.fromCharCode(code)}b`)).toBe('ab')
  })
  it('turns empty or invisible-only input into null', () => {
    expect(normalizeTagline('')).toBeNull()
    expect(normalizeTagline(' \u200b\u2066\u061c ')).toBeNull()
    expect(normalizeTagline(undefined)).toBeNull()
  })
  it('keeps a ZWJ between visible characters (emoji sequences) but drops a stray one', () => {
    const family = '\ud83d\udc68\u200d\ud83d\udc69'
    expect(normalizeTagline(family)).toBe(family)
    expect(normalizeTagline('\u200da\u200d')).toBe('a')
    expect(normalizeTagline('a \u200d b')).toBe('a b')
  })
  it('clamps to 120 characters without splitting a surrogate pair', () => {
    expect(normalizeTagline('a'.repeat(300))).toHaveLength(120)
    expect(normalizeTagline('a'.repeat(119) + '\ud83d\ude00')).toBe('a'.repeat(119))
  })
})

describe('validateTagline', () => {
  it('returns the normalised value', () => {
    expect(validateTagline('  Fast\u200b   forms ')).toEqual({ ok: true, value: 'Fast forms' })
    expect(validateTagline(' \u200b ')).toEqual({ ok: true, value: null })
  })
  it('rejects over-long input with a message instead of cutting it', () => {
    expect(validateTagline('a'.repeat(120))).toEqual({ ok: true, value: 'a'.repeat(120) })
    expect(validateTagline('a'.repeat(121))).toMatchObject({ ok: false, message: expect.stringContaining('120') })
  })
})
