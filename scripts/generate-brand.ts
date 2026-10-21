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
import { BRAND } from '../src/lib/brand'

const out = (f: string) => join(process.cwd(), 'src/app', f)

const adaptive = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><style>.f{fill:${BRAND.neutral.light}}.a{fill:${BRAND.amber.light}}@media (prefers-color-scheme:dark){.f{fill:${BRAND.neutral.dark}}.a{fill:${BRAND.amber.dark}}}</style>
  <path class="f" fill-rule="evenodd" d="${BRAND.blockPath}"/>
  <path class="a" d="${BRAND.slotPath}"/></svg>
`

/** App icon: dark tile, light block, amber slot. The mark is 62.5% of the tile. */
const appIcon = (rx: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rx}" fill="${BRAND.surface}"/><g transform="translate(96 96) scale(10)"><path fill="${BRAND.neutral.dark}" fill-rule="evenodd" d="${BRAND.blockPath}"/><path fill="${BRAND.amber.dark}" d="${BRAND.slotPath}"/></g></svg>`

async function png(size: number, rx: number) {
  return sharp(Buffer.from(appIcon(rx)), { density: 72 * 4 }).resize(size, size).png().toBuffer()
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
  writeFileSync(out('favicon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(size, 112) })))))
  console.log('brand files written')
}

void main()
