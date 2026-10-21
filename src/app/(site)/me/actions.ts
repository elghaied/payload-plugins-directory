'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMaintainer } from '@/lib/auth/current'
import { isValidSlug, pluginTag, templateTag } from '@/lib/cacheTags'
import { saveBranding, type BrandingResult } from '@/lib/maintainers/branding'
import { LOGO_MAX_BYTES, LOGO_MESSAGES } from '@/lib/maintainers/logoLimits'
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MESSAGES } from '@/lib/maintainers/screenshotLimits'
import {
  addTemplateScreenshot,
  moveTemplateScreenshot,
  removeTemplateScreenshot,
  saveTemplateDetails,
} from '@/lib/maintainers/templateEdits'

export type BrandingState = { status: 'idle' } | { status: 'signed_out' } | BrandingResult

// CSRF: Next.js server actions reject cross-origin POSTs, and the session cookie is SameSite=Lax. Every value is
// untrusted; saveBranding re-checks ownership from the DB, validates the file and sets `logo` itself.
export async function saveBrandingAction(_prev: BrandingState, formData: FormData): Promise<BrandingState> {
  const maintainer = await getCurrentMaintainer()
  if (!maintainer) return { status: 'signed_out' }
  const text = (name: string) => {
    const v = formData.get(name)
    return typeof v === 'string' ? v : ''
  }
  const slug = text('slug').slice(0, 200)
  if (!isValidSlug(slug)) return { status: 'forbidden' }
  const file = formData.get('logo')
  if (file instanceof File && file.size > LOGO_MAX_BYTES) return { status: 'invalid', message: LOGO_MESSAGES.tooBig }
  const logo = file instanceof File && file.size > 0 ? { data: Buffer.from(await file.arrayBuffer()) } : null

  const payload = await getPayload({ config: await config })
  try {
    const result = await saveBranding({ payload, maintainer, slug, tagline: text('tagline'), logo, removeLogo: text('removeLogo') === 'on' })
    if (result.status === 'saved') {
      updateTag(pluginTag(slug)) // read-your-writes on the detail page; the list refreshes through the hook's revalidate job
      revalidatePath('/me')
    }
    return result
  } catch (err) {
    payload.logger.error({ err }, 'branding: unexpected failure')
    return { status: 'invalid', message: 'Something went wrong while saving. Please try again in a moment.' }
  }
}

export type TemplateEditState = BrandingState

const textOf = (formData: FormData) => (name: string) => {
  const v = formData.get(name)
  return typeof v === 'string' ? v : ''
}

/** A positive integer media id from the form, or null. Whether the template references it is checked by the lib function. */
function parseMediaId(raw: string): number | null {
  if (!/^[1-9][0-9]{0,15}$/.test(raw)) return null
  const id = Number(raw)
  return Number.isSafeInteger(id) ? id : null
}

/**
 * Shared shape of the template server actions (the saveBrandingAction pattern): signed in, valid slug, then the lib
 * function, which re-checks ownership from the DB and decides everything else. Only the named form keys are read;
 * extra keys are ignored. On success: read-your-writes on the template page, and /me re-renders.
 */
async function runTemplateEdit(
  formData: FormData,
  scope: string,
  run: (args: { payload: Awaited<ReturnType<typeof getPayload>>; maintainer: NonNullable<Awaited<ReturnType<typeof getCurrentMaintainer>>>; slug: string }) => Promise<BrandingResult>,
): Promise<TemplateEditState> {
  const maintainer = await getCurrentMaintainer()
  if (!maintainer) return { status: 'signed_out' }
  const slug = textOf(formData)('slug').slice(0, 200)
  if (!isValidSlug(slug)) return { status: 'forbidden' }
  const payload = await getPayload({ config: await config })
  try {
    const result = await run({ payload, maintainer, slug })
    if (result.status === 'saved') {
      updateTag(templateTag(slug))
      revalidatePath('/me')
    }
    return result
  } catch (err) {
    payload.logger.error({ err }, `${scope}: unexpected failure`)
    return { status: 'invalid', message: 'Something went wrong while saving. Please try again in a moment.' }
  }
}

export async function saveTemplateDetailsAction(_prev: TemplateEditState, formData: FormData): Promise<TemplateEditState> {
  const text = textOf(formData)
  return runTemplateEdit(formData, 'template details', ({ payload, maintainer, slug }) =>
    saveTemplateDetails({ payload, maintainer, slug, tagline: text('tagline'), demoUrl: text('demoUrl'), videoUrl: text('videoUrl'), stackOverride: text('stackOverride') }),
  )
}

export async function addTemplateScreenshotAction(_prev: TemplateEditState, formData: FormData): Promise<TemplateEditState> {
  // Signed out first (as runTemplateEdit does), then the size pre-check before reading the bytes; one file per call.
  if (!(await getCurrentMaintainer())) return { status: 'signed_out' }
  const file = formData.get('screenshot')
  if (file instanceof File && file.size > SCREENSHOT_MAX_BYTES) return { status: 'invalid', message: SCREENSHOT_MESSAGES.tooBig }
  return runTemplateEdit(formData, 'template screenshot', async ({ payload, maintainer, slug }) => {
    if (!(file instanceof File) || file.size === 0) return { status: 'invalid', message: 'Choose an image to upload.' }
    return addTemplateScreenshot({ payload, maintainer, slug, file: { data: Buffer.from(await file.arrayBuffer()) } })
  })
}

export async function removeTemplateScreenshotAction(_prev: TemplateEditState, formData: FormData): Promise<TemplateEditState> {
  const mediaId = parseMediaId(textOf(formData)('mediaId'))
  return runTemplateEdit(formData, 'template screenshot', async ({ payload, maintainer, slug }) =>
    mediaId === null ? { status: 'forbidden' } : removeTemplateScreenshot({ payload, maintainer, slug, mediaId }),
  )
}

export async function moveTemplateScreenshotAction(_prev: TemplateEditState, formData: FormData): Promise<TemplateEditState> {
  const text = textOf(formData)
  const mediaId = parseMediaId(text('mediaId'))
  const direction = text('direction')
  return runTemplateEdit(formData, 'template screenshot', async ({ payload, maintainer, slug }) =>
    mediaId === null || (direction !== 'up' && direction !== 'down')
      ? { status: 'forbidden' }
      : moveTemplateScreenshot({ payload, maintainer, slug, mediaId, direction }),
  )
}
