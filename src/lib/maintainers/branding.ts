import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { Forbidden } from 'payload'
import sharp from 'sharp'
import { MAINTAINER_BRANDING_CONTEXT_KEY } from '@/collections/hooks/restrictMaintainerPluginEdits'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { relationId } from '@/lib/relationId'
import { LOGO_MAX_BYTES, LOGO_MAX_DIMENSION, LOGO_MESSAGES } from './logoLimits'
import { validateTagline } from './tagline'

export { LOGO_MAX_BYTES, LOGO_MAX_DIMENSION, LOGO_MESSAGES }

type ImageKind = { mime: 'image/png' | 'image/jpeg' | 'image/webp'; ext: 'png' | 'jpg' | 'webp' }
const ascii = (buf: Uint8Array, start: number, end: number) => String.fromCharCode(...buf.subarray(start, end))

/** PNG, JPEG or WebP by magic bytes; anything else (notably SVG, HTML and GIF) is refused. The declared MIME type is never trusted. */
export function detectImageType(buf: Uint8Array): ImageKind | null {
  if (buf.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => buf[i] === b)) return { mime: 'image/png', ext: 'png' }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' }
  if (buf.length >= 12 && ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' }
  return null
}

export type BrandingResult = { status: 'saved' } | { status: 'forbidden' } | { status: 'invalid'; message: string }

/** Deletes a media row nothing references. Never throws: a failed cleanup is logged and must not mask the real outcome. */
async function deleteIfUnreferenced(payload: Payload, mediaId: number) {
  try {
    const refs = await payload.find({
      collection: 'plugins', where: { logo: { equals: mediaId } }, trash: true, limit: 1, depth: 0, overrideAccess: true,
    })
    if (refs.totalDocs === 0) await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })
  } catch (err) {
    payload.logger.error({ err, mediaId }, 'branding: could not delete unreferenced media')
  }
}

type Reencoded = { data: Buffer; kind: ImageKind } | { error: string }

/**
 * Decodes and re-encodes the upload in its own format. That drops EXIF/GPS/XMP and any bytes after the image, and
 * proves the file really decodes. EXIF orientation is applied first so the picture does not change.
 */
async function reencodeLogo(input: Buffer, kind: ImageKind): Promise<Reencoded> {
  try {
    const base = sharp(input, { limitInputPixels: LOGO_MAX_DIMENSION * LOGO_MAX_DIMENSION }).rotate()
    const pipeline = kind.mime === 'image/png' ? base.png() : kind.mime === 'image/jpeg' ? base.jpeg({ quality: 90 }) : base.webp({ quality: 90 })
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
    if (info.width > LOGO_MAX_DIMENSION || info.height > LOGO_MAX_DIMENSION) return { error: LOGO_MESSAGES.tooLarge }
    if (data.length > LOGO_MAX_BYTES) return { error: LOGO_MESSAGES.tooBig }
    return { data, kind }
  } catch (err) {
    return { error: /pixel limit/i.test(String((err as Error)?.message)) ? LOGO_MESSAGES.tooLarge : LOGO_MESSAGES.wrongType }
  }
}

/**
 * The only path that can set a plugin's `logo` (Plugins access + restrictMaintainerPluginEdits reject it otherwise).
 * Ownership is re-checked from the DB BEFORE anything is uploaded; the file is sniffed, size- and dimension-capped.
 */
export async function saveBranding({
  payload,
  maintainer,
  slug,
  tagline,
  logo,
  removeLogo,
}: {
  payload: Payload
  maintainer: CurrentMaintainer
  slug: string
  tagline: string
  logo?: { data: Buffer } | null
  removeLogo?: boolean
}): Promise<BrandingResult> {
  const normalized = validateTagline(tagline)
  if (!normalized.ok) return { status: 'invalid', message: normalized.message }

  // Ownership check BEFORE any upload, as the maintainer (listed plugins only).
  const found = await payload.find({
    collection: 'plugins', overrideAccess: false, user: maintainer, depth: 0, limit: 1, where: { slug: { equals: slug } },
  })
  const plugin = found.docs[0]
  if (!plugin || !(plugin.maintainers ?? []).map(relationId).includes(maintainer.id)) return { status: 'forbidden' }

  const previousLogo = relationId(plugin.logo)
  let nextLogo: number | null | undefined // undefined = unchanged
  let createdMedia: number | undefined

  if (logo && logo.data.length > 0) {
    if (logo.data.length > LOGO_MAX_BYTES) return { status: 'invalid', message: LOGO_MESSAGES.tooBig }
    const kind = detectImageType(logo.data)
    if (!kind) return { status: 'invalid', message: LOGO_MESSAGES.wrongType }
    const clean = await reencodeLogo(Buffer.from(logo.data), kind)
    if ('error' in clean) return { status: 'invalid', message: clean.error }
    // System write: `media` create is admin-only (spec 9.1). Ownership was verified above and the bytes were sniffed
    // and capped; the media row created here is the only value `logo` is ever set to.
    const media = await payload.create({
      collection: 'media',
      overrideAccess: true,
      depth: 0,
      data: { alt: `${plugin.name} logo`, origin: 'maintainer' },
      file: { data: clean.data, mimetype: kind.mime, name: `${plugin.slug}-logo-${Date.now()}-${randomBytes(3).toString('hex')}.${kind.ext}`, size: clean.data.length },
    })
    nextLogo = createdMedia = media.id
  } else if (removeLogo) {
    nextLogo = null
  }

  try {
    // As the maintainer: access + restrictMaintainerPluginEdits apply (only these two keys are sent). The context flag
    // lets `logo` through; no `req` is passed, so it lives on this call's own request only. Revalidation is decided by
    // the Plugins hook (no skipRevalidate).
    await payload.update({
      collection: 'plugins',
      id: plugin.id,
      overrideAccess: false,
      user: maintainer,
      depth: 0,
      context: nextLogo !== undefined ? { [MAINTAINER_BRANDING_CONTEXT_KEY]: true } : {},
      data: { customTagline: normalized.value, ...(nextLogo !== undefined ? { logo: nextLogo } : {}) },
    })
  } catch (err) {
    if (createdMedia !== undefined) await deleteMediaQuietly(payload, createdMedia)
    if (err instanceof Forbidden) return { status: 'forbidden' }
    throw err
  }

  if (createdMedia !== undefined) {
    // A parallel save may have replaced our logo already: then ours is unreferenced and must not linger.
    await deleteIfUnreferenced(payload, createdMedia)
  }
  if (nextLogo !== undefined && previousLogo !== undefined && previousLogo !== nextLogo) {
    await deleteIfUnreferenced(payload, previousLogo)
  }
  return { status: 'saved' }
}

async function deleteMediaQuietly(payload: Payload, id: number) {
  try {
    await payload.delete({ collection: 'media', id, overrideAccess: true })
  } catch (err) {
    payload.logger.error({ err, mediaId: id }, 'branding: could not delete media after a failed save') // the sweep removes it later
  }
}
