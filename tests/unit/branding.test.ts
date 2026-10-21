import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { detectImageType } from '@/lib/maintainers/branding'
import { detectImageType as sniff, reencodeImage } from '@/lib/maintainers/imageReencode'
import { normalizeTagline, validateTagline } from '@/lib/maintainers/tagline'

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

describe('detectImageType', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex')
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 ')])
  it('recognises PNG, JPEG and WebP by magic bytes', () => {
    expect(detectImageType(png)).toEqual({ mime: 'image/png', ext: 'png' })
    expect(detectImageType(jpeg)).toEqual({ mime: 'image/jpeg', ext: 'jpg' })
    expect(detectImageType(webp)).toEqual({ mime: 'image/webp', ext: 'webp' })
  })
  it('rejects SVG, HTML, GIF and empty input', () => {
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(detectImageType(Buffer.from('<!doctype html><script>'))).toBeNull()
    expect(detectImageType(Buffer.from('GIF89a'))).toBeNull()
    expect(detectImageType(Buffer.alloc(0))).toBeNull()
  })
})

describe('imageReencode', () => {
  it('branding re-exports the shared sniffer', () => {
    expect(detectImageType).toBe(sniff)
  })
  it('the shared sniffer still refuses SVG and GIF', () => {
    expect(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull()
    expect(sniff(Buffer.from('GIF89a\x01\x00\x01\x00'))).toBeNull()
    expect(sniff(Buffer.from('GIF87a'))).toBeNull()
  })
  it('re-encodes to WebP when asked, within the dimension cap', async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#123456' } }).png().toBuffer()
    const out = await reencodeImage(png, sniff(png)!, { maxDimension: 4096, maxBytes: 2 * 1024 * 1024, format: 'webp' })
    if ('error' in out) throw new Error(out.error)
    expect(out.kind).toEqual({ mime: 'image/webp', ext: 'webp' })
    expect(sniff(out.data)).toEqual({ mime: 'image/webp', ext: 'webp' })
  })
  it('keeps the input format by default, and reports over-dimension and pixel-limit input as tooLarge', async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#123456' } }).png().toBuffer()
    const same = await reencodeImage(png, sniff(png)!, { maxDimension: 64, maxBytes: 1024 * 1024 })
    expect('error' in same ? same.error : same.kind.mime).toBe('image/png')
    expect(await reencodeImage(png, sniff(png)!, { maxDimension: 32, maxBytes: 1024 * 1024 })).toEqual({ error: 'tooLarge' })
    const big = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#000' } }).png().toBuffer()
    expect(await reencodeImage(big, sniff(big)!, { maxDimension: 100, maxBytes: 1024 * 1024 })).toEqual({ error: 'tooLarge' })
  })
  it('reports undecodable bytes as wrongType', async () => {
    const fake = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from('not really a png')])
    expect(await reencodeImage(fake, sniff(fake)!, { maxDimension: 100, maxBytes: 1024 })).toEqual({ error: 'wrongType' })
  })
})
