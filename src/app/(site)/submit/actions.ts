'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMaintainer } from '@/lib/auth/current'
import { MESSAGES } from '@/lib/submissions/messages'
import { submitListing, type SubmitResult } from '@/lib/submissions/submit'

export type SubmitState = { status: 'idle' } | { status: 'signed_out' } | SubmitResult

// CSRF: Next.js server actions reject cross-origin POSTs (Origin vs Host check), and the session cookie is SameSite=Lax.
// Every value is untrusted: it is coerced to a string here and parsed/validated again in submitListing and the collection hook.
export async function submitListingAction(_prev: SubmitState, formData: FormData): Promise<SubmitState> {
  const maintainer = await getCurrentMaintainer()
  if (!maintainer) return { status: 'signed_out' }
  const payload = await getPayload({ config: await config })
  const field = (name: string) => {
    const value = formData.get(name)
    return typeof value === 'string' ? value : ''
  }
  try {
    return await submitListing({ payload, maintainer, url: field('url'), note: field('note') })
  } catch (err) {
    payload.logger.error({ err }, 'submit: unexpected failure')
    return { status: 'invalid', message: MESSAGES.submitFailed }
  }
}
