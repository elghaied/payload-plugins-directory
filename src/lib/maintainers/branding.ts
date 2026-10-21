import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { Forbidden } from 'payload'
import { MAINTAINER_BRANDING_CONTEXT_KEY } from '@/collections/hooks/restrictMaintainerPluginEdits'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { relationId } from '@/lib/relationId'
import { detectImageType, reencodeImage } from './imageReencode'
import { deleteMediaIfUnreferenced, deleteMediaQuietly } from './mediaCleanup'
import { LOGO_MAX_BYTES, LOGO_MAX_DIMENSION, LOGO_MESSAGES } from './logoLimits'
import { validateTagline } from './tagline'

export { LOGO_MAX_BYTES, LOGO_MAX_DIMENSION, LOGO_MESSAGES }

export { detectImageType }

export type BrandingResult = { status: 'saved' } | { status: 'forbidden' } | { status: 'invalid'; message: string }

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
    const clean = await reencodeImage(Buffer.from(logo.data), kind, { maxDimension: LOGO_MAX_DIMENSION, maxBytes: LOGO_MAX_BYTES })
    if ('error' in clean) return { status: 'invalid', message: LOGO_MESSAGES[clean.error] }
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
    if (createdMedia !== undefined) await deleteMediaQuietly(payload, createdMedia, 'branding')
    if (err instanceof Forbidden) return { status: 'forbidden' }
    throw err
  }

  if (createdMedia !== undefined) {
    // A parallel save may have replaced our logo already: then ours is unreferenced and must not linger.
    await deleteMediaIfUnreferenced(payload, createdMedia, 'branding')
  }
  if (nextLogo !== undefined && previousLogo !== undefined && previousLogo !== nextLogo) {
    await deleteMediaIfUnreferenced(payload, previousLogo, 'branding')
  }
  return { status: 'saved' }
}
