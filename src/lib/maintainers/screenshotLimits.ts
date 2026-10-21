// Dependency-free so the client form can import it.
export const SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024
/** Longest side, in pixels, of an uploaded screenshot (a small file can still decode to a huge bitmap). */
export const SCREENSHOT_MAX_DIMENSION = 4096
/** Matches `templates.screenshots` maxRows. */
export const SCREENSHOT_MAX_COUNT = 8
export const SCREENSHOT_MESSAGES = {
  tooBig: 'The screenshot must be 2 MB or smaller.',
  wrongType: 'Upload a PNG, JPEG or WebP image.',
  tooLarge: `The screenshot must be at most ${SCREENSHOT_MAX_DIMENSION} x ${SCREENSHOT_MAX_DIMENSION} pixels.`,
  tooMany: `A template can have at most ${SCREENSHOT_MAX_COUNT} screenshots.`,
} as const
