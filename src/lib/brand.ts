/**
 * The directory's mark, "PD 2: Negative-space P": a solid D block with a P carved out as negative space and its
 * counter kept as an amber slot. One geometry in a 32x32 box, shared by the navbar logo, src/app/icon.svg, the
 * Open Graph image and scripts/generate-brand.ts.
 */
export const BRAND = {
  /** Amber accent: #FFB224 on dark surfaces, #B45309 on light ones. */
  amber: { light: '#B45309', dark: '#FFB224' },
  /** Neutral block colour: the site's near-black on light, near-white on dark. */
  neutral: { light: '#1D1D1B', dark: '#FAFAFA' },
  /** Dark surfaces used by the app icon and the Open Graph card. */
  surface: '#0A0A0A',
  og: { background: '#0A0A0A', foreground: '#FAFAFA', muted: '#A3A3A3', faint: '#1C1C1C' },
  /** D block with the P knocked out (fill-rule evenodd). */
  blockPath: 'M0 0H16A16 16 0 0 1 16 32H0ZM8 6H16A8 8 0 0 1 16 22H12V32H8ZM12 10H16A4 4 0 0 1 16 18H12Z',
  /** The P counter, drawn in amber. */
  slotPath: 'M12 10H16A4 4 0 0 1 16 18H12Z',
} as const
