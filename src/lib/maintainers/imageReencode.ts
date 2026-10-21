import sharp from 'sharp'

export type ImageKind = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' }
const ascii = (buf: Uint8Array, start: number, end: number) => String.fromCharCode(...buf.subarray(start, end))

/** PNG, JPEG or WebP by magic bytes; anything else (notably SVG, HTML and GIF) is refused. The declared MIME type is never trusted. */
export function detectImageType(buf: Uint8Array): ImageKind | null {
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return { mime: 'image/png', ext: 'png' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

const WEBP: ImageKind = { mime: 'image/webp', ext: 'webp' }

/** Why a re-encode was refused; callers map it to their own message. */
export type ReencodeError = 'tooBig' | 'tooLarge' | 'wrongType'
export type Reencoded = { data: Buffer; kind: ImageKind } | { error: ReencodeError }

/**
 * Decodes and re-encodes a sniffed upload. That drops EXIF/GPS/XMP and any bytes after the image, and proves the file
 * really decodes. EXIF orientation is applied first so the picture does not change.
 *  - `limitInputPixels` is `maxDimension²`, so a small file that decodes to a huge bitmap (decompression bomb) is refused
 *    before it is decoded; each side is then capped at `maxDimension`.
 *  - Without `format`, the image keeps its own format (PNG, JPEG 90, WebP 90); `format: 'webp'` gives WebP quality 85.
 */
export async function reencodeImage(
  input: Buffer,
  kind: ImageKind,
  { maxDimension, maxBytes, format }: { maxDimension: number; maxBytes: number; format?: 'webp' },
): Promise<Reencoded> {
  try {
    const base = sharp(input, { limitInputPixels: maxDimension * maxDimension }).rotate()
    const target = format === 'webp' ? WEBP : kind
    const pipeline =
      format === 'webp'
        ? base.webp({ quality: 85 })
        : kind.mime === 'image/png'
          ? base.png()
          : kind.mime === 'image/jpeg'
            ? base.jpeg({ quality: 90 })
            : base.webp({ quality: 90 })
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    if (info.width > maxDimension || info.height > maxDimension) return { error: 'tooLarge' }
    if (data.length > maxBytes) return { error: 'tooBig' }
    return { data, kind: target }
  } catch (err) {
    return { error: /pixel limit/i.test(String((err as Error)?.message)) ? 'tooLarge' : 'wrongType' }
  }
}
