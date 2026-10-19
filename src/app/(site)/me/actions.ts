'use server'

import { revalidatePath, updateTag } from 'next/cache'
import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMaintainer } from '@/lib/auth/current'
import { isValidSlug, pluginTag } from '@/lib/cacheTags'
import { LOGO_MAX_BYTES, LOGO_MESSAGES, saveBranding, type BrandingResult } from '@/lib/maintainers/branding'

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
