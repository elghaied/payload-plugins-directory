import { randomBytes } from 'node:crypto'
import type { Payload } from 'payload'
import { Forbidden, ValidationError } from 'payload'
import { MAINTAINER_TEMPLATE_CONTEXT_KEY } from '@/collections/hooks/restrictMaintainerTemplateEdits'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { relationId } from '@/lib/relationId'
import { validationMessage } from '@/lib/submissions/submit'
import { canonicalVideoUrl, parseDemoUrl, parseVideoUrl } from '@/lib/templates/links'
import { STACKS, type StackValue } from '@/lib/templates/stack'
import type { BrandingResult } from './branding'
import { detectImageType, reencodeImage } from './imageReencode'
import { deleteMediaIfUnreferenced, deleteMediaQuietly } from './mediaCleanup'
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, SCREENSHOT_MAX_DIMENSION, SCREENSHOT_MESSAGES } from './screenshotLimits'
import { normalizeTagline, validateTagline } from './tagline'

export { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, SCREENSHOT_MAX_DIMENSION, SCREENSHOT_MESSAGES }

export const TEMPLATE_DETAIL_MESSAGES = {
  demoUrl: 'Enter a public https:// URL for the demo (no credentials, localhost or IP address).',
  videoUrl: 'Enter a YouTube, Vimeo or Loom video URL.',
  stackOverride: 'Choose a stack from the list.',
} as const

type Base = { payload: Payload; maintainer: CurrentMaintainer; slug: string }
type Owned = { id: number; name: string; slug: string; screenshots: number[] }

/**
 * Ownership, read AS THE MAINTAINER (listed, non-trashed templates only) before anything is written or uploaded.
 * Returns the template with its current screenshot ids, or null when the maintainer does not maintain it.
 */
async function findOwnedTemplate({ payload, maintainer, slug }: Base): Promise<Owned | null> {
  const found = await payload.find({
    collection: 'templates', overrideAccess: false, user: maintainer, depth: 0, limit: 1,
    where: { slug: { equals: slug } },
    select: { slug: true, name: true, maintainers: true, screenshots: true },
  })
  const doc = found.docs[0]
  if (!doc || !(doc.maintainers ?? []).map(relationId).includes(maintainer.id)) return null
  const screenshots = (doc.screenshots ?? []).map(relationId).filter((id): id is number => typeof id === 'number')
  return { id: doc.id, name: doc.name, slug: doc.slug, screenshots }
}

/** A fresh context per write (never a shared constant): the key lets `screenshots` through restrictMaintainerTemplateEdits. */
const screenshotContext = () => ({ [MAINTAINER_TEMPLATE_CONTEXT_KEY]: true })

/**
 * The only write of `screenshots` for a maintainer: as the maintainer (access + the field allow-list apply), sending only
 * `screenshots`, with the context key. No `req` is passed, so the key lives on this call's own request only.
 */
async function writeScreenshots(payload: Payload, maintainer: CurrentMaintainer, id: number, screenshots: number[]) {
  await payload.update({
    collection: 'templates', id, overrideAccess: false, user: maintainer, depth: 0,
    context: screenshotContext(),
    data: { screenshots },
  })
}

const isMediaId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

/** Tagline, demo URL, video URL and stack override. Sends only those four keys, as the maintainer. */
export async function saveTemplateDetails({
  payload,
  maintainer,
  slug,
  tagline,
  demoUrl,
  videoUrl,
  stackOverride,
}: Base & { tagline: string; demoUrl: string; videoUrl: string; stackOverride: string }): Promise<BrandingResult> {
  const template = await findOwnedTemplate({ payload, maintainer, slug })
  if (!template) return { status: 'forbidden' }

  const normalized = validateTagline(tagline)
  if (!normalized.ok) return { status: 'invalid', message: normalized.message }
  const demoRaw = typeof demoUrl === 'string' ? demoUrl.trim() : ''
  const demo = demoRaw ? parseDemoUrl(demoRaw) : null
  if (demoRaw && !demo) return { status: 'invalid', message: TEMPLATE_DETAIL_MESSAGES.demoUrl }
  const videoRaw = typeof videoUrl === 'string' ? videoUrl.trim() : ''
  const videoRef = videoRaw ? parseVideoUrl(videoRaw) : null
  if (videoRaw && !videoRef) return { status: 'invalid', message: TEMPLATE_DETAIL_MESSAGES.videoUrl }
  const stackRaw = typeof stackOverride === 'string' ? stackOverride.trim() : ''
  if (stackRaw && !(STACKS as readonly string[]).includes(stackRaw)) return { status: 'invalid', message: TEMPLATE_DETAIL_MESSAGES.stackOverride }

  try {
    await payload.update({
      collection: 'templates', id: template.id, overrideAccess: false, user: maintainer, depth: 0,
      data: {
        customTagline: normalized.value,
        demoUrl: demo,
        videoUrl: videoRef ? canonicalVideoUrl(videoRef) : null,
        stackOverride: stackRaw ? (stackRaw as StackValue) : null,
      },
    })
  } catch (err) {
    if (err instanceof Forbidden) return { status: 'forbidden' }
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
  return { status: 'saved' }
}

/**
 * Appends one uploaded screenshot. Order: ownership, count, size, content sniff (PNG, JPEG or WebP), re-encode to WebP
 * within 4096 px (with a pixel limit, so a decompression bomb is refused before decoding), create the media row, then
 * append it to the template's CURRENT screenshots. On any failure after the upload the new media row is deleted.
 */
export async function addTemplateScreenshot({
  payload,
  maintainer,
  slug,
  file,
  alt,
}: Base & { file: { data: Buffer }; alt?: string }): Promise<BrandingResult> {
  const template = await findOwnedTemplate({ payload, maintainer, slug })
  if (!template) return { status: 'forbidden' }
  if (template.screenshots.length >= SCREENSHOT_MAX_COUNT) return { status: 'invalid', message: SCREENSHOT_MESSAGES.tooMany }
  if (!file || file.data.length === 0) return { status: 'invalid', message: SCREENSHOT_MESSAGES.wrongType }
  if (file.data.length > SCREENSHOT_MAX_BYTES) return { status: 'invalid', message: SCREENSHOT_MESSAGES.tooBig }
  const kind = detectImageType(file.data)
  if (!kind) return { status: 'invalid', message: SCREENSHOT_MESSAGES.wrongType }
  const clean = await reencodeImage(Buffer.from(file.data), kind, { maxDimension: SCREENSHOT_MAX_DIMENSION, maxBytes: SCREENSHOT_MAX_BYTES, format: 'webp' })
  if ('error' in clean) return { status: 'invalid', message: SCREENSHOT_MESSAGES[clean.error] }

  // System write: `media` create is admin-only. Ownership was verified above and the bytes were sniffed, re-encoded and
  // capped; this row is the only new value `screenshots` gains. A caller's alt text is normalised like a tagline.
  const media = await payload.create({
    collection: 'media',
    overrideAccess: true,
    depth: 0,
    data: { alt: normalizeTagline(alt) ?? `${template.name} screenshot`, origin: 'template-screenshot' },
    file: {
      data: clean.data,
      mimetype: clean.kind.mime,
      name: `${template.slug}-screenshot-${Date.now()}-${randomBytes(3).toString('hex')}.${clean.kind.ext}`,
      size: clean.data.length,
    },
  })

  let next: number[] = []
  try {
    // Re-read: another tab may have added, moved or removed screenshots since the ownership read.
    const current = await findOwnedTemplate({ payload, maintainer, slug })
    if (!current) {
      await deleteMediaQuietly(payload, media.id, 'template screenshot')
      return { status: 'forbidden' }
    }
    // Known race (accepted): the screenshots array is read then written in full, so two uploads at the same moment can
    // lose one entry (last write wins). The lost media row is unreferenced and `sweepOrphanMedia` deletes it after a day.
    // `maxRows` (8) still rejects a 9th that raced past the count check above.
    next = [...current.screenshots, media.id]
    await writeScreenshots(payload, maintainer, current.id, next)
  } catch (err) {
    await deleteMediaQuietly(payload, media.id, 'template screenshot')
    if (err instanceof Forbidden) return { status: 'forbidden' }
    if (err instanceof ValidationError) {
      return { status: 'invalid', message: isTooManyScreenshots(err, next.length) ? SCREENSHOT_MESSAGES.tooMany : validationMessage(err) }
    }
    throw err
  }
  return { status: 'saved' }
}

/** The `screenshots` maxRows failure (and only that): a `screenshots` error on a write of more than 8 ids. */
export function isTooManyScreenshots(err: ValidationError, attempted: number): boolean {
  const errors = (err.data as { errors?: { path?: string }[] } | undefined)?.errors ?? []
  return attempted > SCREENSHOT_MAX_COUNT && errors.some((e) => e.path === 'screenshots')
}

/**
 * Removes one screenshot the template currently references. Its media row is deleted only when it was uploaded as a
 * template screenshot (`origin: 'template-screenshot'`) and nothing references it any more; any other row (an admin
 * upload attached by an admin) is only unlinked and kept. An id the template does not reference is `forbidden` and
 * nothing is changed.
 */
export async function removeTemplateScreenshot({ payload, maintainer, slug, mediaId }: Base & { mediaId: number }): Promise<BrandingResult> {
  if (!isMediaId(mediaId)) return { status: 'forbidden' }
  const template = await findOwnedTemplate({ payload, maintainer, slug })
  if (!template || !template.screenshots.includes(mediaId)) return { status: 'forbidden' }
  try {
    await writeScreenshots(payload, maintainer, template.id, template.screenshots.filter((id) => id !== mediaId))
  } catch (err) {
    if (err instanceof Forbidden) return { status: 'forbidden' }
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
  // System read: `origin` is admin-only. Ownership and the reference were proven above.
  const media = await payload.findByID({ collection: 'media', id: mediaId, overrideAccess: true, depth: 0, disableErrors: true, select: { origin: true } })
  if (media?.origin === 'template-screenshot') await deleteMediaIfUnreferenced(payload, mediaId, 'template screenshot')
  return { status: 'saved' }
}

/** Moves one referenced screenshot a place up or down. At either end it is a no-op (`saved`, nothing written). */
export async function moveTemplateScreenshot({
  payload,
  maintainer,
  slug,
  mediaId,
  direction,
}: Base & { mediaId: number; direction: 'up' | 'down' }): Promise<BrandingResult> {
  if (!isMediaId(mediaId) || (direction !== 'up' && direction !== 'down')) return { status: 'forbidden' }
  const template = await findOwnedTemplate({ payload, maintainer, slug })
  if (!template) return { status: 'forbidden' }
  const from = template.screenshots.indexOf(mediaId)
  if (from === -1) return { status: 'forbidden' }
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= template.screenshots.length) return { status: 'saved' }
  const next = [...template.screenshots]
  ;[next[from], next[to]] = [next[to], next[from]]
  try {
    await writeScreenshots(payload, maintainer, template.id, next)
  } catch (err) {
    if (err instanceof Forbidden) return { status: 'forbidden' }
    if (err instanceof ValidationError) return { status: 'invalid', message: validationMessage(err) }
    throw err
  }
  return { status: 'saved' }
}
