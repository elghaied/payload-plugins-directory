// Dependency-free so the client form can import it.
export const LOGO_MAX_BYTES = 524288
/** Longest side, in pixels, of an uploaded logo (a small file can still decode to a huge bitmap). */
export const LOGO_MAX_DIMENSION = 2048
export const LOGO_MESSAGES = {
  tooBig: 'The logo must be 512 KB or smaller.',
  wrongType: 'Upload a PNG, JPEG or WebP image.',
  tooLarge: `The logo must be at most ${LOGO_MAX_DIMENSION} x ${LOGO_MAX_DIMENSION} pixels.`,
} as const
