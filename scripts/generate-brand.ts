/**
 * Regenerates the brand files from src/lib/brand.ts:
 *   src/app/icon.svg (adaptive via prefers-color-scheme), src/app/apple-icon.png (180x180),
 *   src/app/favicon.ico (16/32/48 PNG frames).
 * The Open Graph image is rendered at request time by src/app/opengraph-image.tsx.
 * Run: pnpm exec tsx scripts/generate-brand.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { BRAND, glyphMarkup } from '../src/lib/brand'

const out = (f: string) => join(process.cwd(), 'src/app', f)

const icon = (square: string, glyph: string, rx: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rx}" fill="${square}"/>${glyphMarkup(glyph)}</svg>`

const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.s{fill:${BRAND.light.square}}.g{fill:${BRAND.light.glyph}}@media (prefers-color-scheme:dark){.s{fill:${BRAND.dark.square}}.g{fill:${BRAND.dark.glyph}}}</style><rect class="s" width="32" height="32" rx="8"/><g class="g">${glyphMarkup('currentColor')
  .replace(/ fill="currentColor"/g, '')}</g></svg>\n`

async function png(size: number, rx: number, scheme: 'light' | 'dark' = 'light') {
  const c = BRAND[scheme]
  return sharp(Buffer.from(icon(c.square, c.glyph, rx)), { density: (72 * size) / 32 * 4 }).resize(size, size).png().toBuffer()
}

function ico(frames: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(frames.length, 4)
  let offset = 6 + 16 * frames.length
  const dir = frames.map(({ size, data }) => {
    const e = Buffer.alloc(16)
    e.writeUInt8(size, 0)
    e.writeUInt8(size, 1)
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += data.length
    return e
  })
  return Buffer.concat([header, ...dir, ...frames.map((f) => f.data)])
}

async function main() {
  writeFileSync(out('icon.svg'), adaptive)
  // iOS rounds the corners itself: full-bleed square.
  writeFileSync(out('apple-icon.png'), await png(180, 0))
  const sizes = [16, 32, 48]
  writeFileSync(out('favicon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size, 8) })))))
  console.log('brand files written')
}

void main()
