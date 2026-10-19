import type { Payload } from 'payload'
import { Forbidden } from 'payload'
import sharp from 'sharp'
import { MAINTAINER_BRANDING_CONTEXT_KEY } from '@/collections/hooks/restrictMaintainerPluginEdits'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { relationId } from '@/lib/relationId'
import { clampChars } from '@/sync/limits'

export const LOGO_MAX_BYTES = 524288
/** Longest side, in pixels, of an uploaded logo (a small file can still decode to a huge bitmap). */
export const LOGO_MAX_DIMENSION = 2048
export const LOGO_MESSAGES = {
  tooBig: 'The logo must be 512 KB or smaller.',
  wrongType: 'Upload a PNG, JPEG or WebP image.',
  tooLarge: `The logo must be at most ${LOGO_MAX_DIMENSION} pixels wide and tall.`,
} as const

export const CUSTOM_TAGLINE_MAX_CHARS = 120

// Control characters become a space. Written with \u escapes only: literal invisible characters get lost in editors.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/g
// Zero-width, soft hyphen and bidi-control characters are removed outright (U+200D, the joiner, is handled separately):
// U+00AD, U+061C, U+200B-U+200C, U+200E-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069, U+FEFF.
const INVISIBLE_RE = /[\u00ad\u061c\u200b\u200c\u200e\u200f\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g
const ZWJ = '\u200d'

/** NFKC, invisible characters removed, whitespace collapsed, trimmed. A ZWJ survives only between two visible characters (emoji sequences). */
function clean(input: string): string {
  const base = input.normalize('NFKC').replace(CONTROL_RE, ' ').replace(INVISIBLE_RE, '')
  const joined = base.replace(/\u200d/g, (_m, offset: number) => {
    const before = base[offset - 1]
    const after = base[offset + 1]
    return before && after && /\S/.test(before) && /\S/.test(after) && before !== ZWJ && after !== ZWJ ? ZWJ : ''
  })
  return joined.replace(/\s+/g, ' ').trim()
}

/**
 * Last-line normaliser, used by the `customTagline` field hook so every write path (server action, REST, GraphQL,
 * admin) is normalised. Empty becomes null; over-long input is clamped to 120 characters as a safety net.
 * User-facing input should go through `validateTagline`, which rejects instead of cutting.
 */
export function normalizeTagline(input: unknown): string | null {
  if (typeof input !== 'string') return null
  const cleaned = clean(input)
  if (!cleaned) return null
  return clampChars(cleaned, CUSTOM_TAGLINE_MAX_CHARS).trim() || null
}

export type TaglineValidation = { ok: true; value: string | null } | { ok: false; message: string }

/** For forms and server actions: normalises, and rejects (with a message) a tagline over 120 characters instead of cutting it. */
export function validateTagline(input: unknown): TaglineValidation {
  if (typeof input !== 'string') return { ok: true, value: null }
  const cleaned = clean(input)
  if (!cleaned) return { ok: true, value: null }
  if (cleaned.length > CUSTOM_TAGLINE_MAX_CHARS) return { ok: false, message: `Keep the tagline to ${CUSTOM_TAGLINE_MAX_CHARS} characters or fewer.` }
  return { ok: true, value: cleaned }
}

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

async function deleteIfUnreferenced(payload: Payload, mediaId: number) {
  const refs = await payload.find({
    collection: 'plugins', where: { logo: { equals: mediaId } }, trash: true, limit: 1, depth: 0, overrideAccess: true,
  })
  if (refs.totalDocs === 0) await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })
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
    try {
      const meta = await sharp(logo.data, { limitInputPixels: LOGO_MAX_DIMENSION * LOGO_MAX_DIMENSION }).metadata()
      if (!meta.width || !meta.height || meta.width > LOGO_MAX_DIMENSION || meta.height > LOGO_MAX_DIMENSION) {
        return { status: 'invalid', message: LOGO_MESSAGES.tooLarge }
      }
    } catch {
      return { status: 'invalid', message: LOGO_MESSAGES.wrongType }
    }
    // System write: `media` create is admin-only (spec 9.1). Ownership was verified above and the bytes were sniffed
    // and capped; the media row created here is the only value `logo` is ever set to.
    const media = await payload.create({
      collection: 'media',
      overrideAccess: true,
      depth: 0,
      data: { alt: `${plugin.name} logo` },
      file: { data: logo.data, mimetype: kind.mime, name: `${plugin.slug}-logo-${Date.now()}.${kind.ext}`, size: logo.data.length },
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
    if (createdMedia !== undefined) await payload.delete({ collection: 'media', id: createdMedia, overrideAccess: true })
    if (err instanceof Forbidden) return { status: 'forbidden' }
    throw err
  }

  if (nextLogo !== undefined && previousLogo !== undefined && previousLogo !== nextLogo) {
    await deleteIfUnreferenced(payload, previousLogo)
  }
  return { status: 'saved' }
}
