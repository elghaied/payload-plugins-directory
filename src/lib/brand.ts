/**
 * The directory's mark: a plug (two prongs, a half-round body, a cable stub) knocked out of a rounded square.
 * One geometry, drawn in a 32x32 box, shared by the navbar logo, src/app/icon.svg, the Open Graph image and
 * scripts/generate-brand.ts. Original artwork: not derived from any Payload CMS mark.
 */
export const BRAND = {
  /** Square fill: teal-700 (white glyph = 5.5:1) in light, teal-400 (near-black glyph) in dark. */
  light: { square: '#0f766e', glyph: '#ffffff' },
  dark: { square: '#2dd4bf', glyph: '#042f2e' },
  /** Plug glyph as SVG shapes in the 32x32 box. */
  glyph: [
    { tag: 'rect', x: 11, y: 5, width: 3, height: 7, rx: 1.5 },
    { tag: 'rect', x: 18, y: 5, width: 3, height: 7, rx: 1.5 },
    { tag: 'path', d: 'M8.5 11.5h15v3.5a7.5 7.5 0 0 1-15 0z' },
    { tag: 'rect', x: 14.5, y: 22, width: 3, height: 4.5, rx: 1.5 },
  ],
} as const

type Shape = (typeof BRAND.glyph)[number]

/** Shape attributes as an SVG markup string. */
export function glyphMarkup(fill: string): string {
  return BRAND.glyph
    .map((s: Shape) =>
      s.tag === 'rect'
        ? `<rect x="${s.x}" y="${s.y}" width="${s.width}" height="${s.height}" rx="${s.rx}" fill="${fill}"/>`
        : `<path d="${s.d}" fill="${fill}"/>`,
    )
    .join('')
}
