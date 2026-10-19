'use server'

import { getPayload } from 'payload'
import config from '@payload-config'
import { getCurrentMaintainer } from '@/lib/auth/current'
import { createGitHubAuthClient } from '@/lib/github/client'
import { claimPlugin, type ClaimResult } from '@/lib/submissions/claim'
import { MESSAGES } from '@/lib/submissions/messages'

export type ClaimState = { status: 'idle' } | { status: 'signed_out' } | ClaimResult

// CSRF: Next.js server actions reject cross-origin POSTs (Origin vs Host check), and the session cookie is SameSite=Lax.
// Every value is untrusted: coerced to a string here, and claimPlugin re-validates everything (listed plugin lookup,
// duplicates, cap, live GitHub ownership). The caller never learns why a claim was queued.
export async function claimPluginAction(_prev: ClaimState, formData: FormData): Promise<ClaimState> {
  const maintainer = await getCurrentMaintainer()
  if (!maintainer) return { status: 'signed_out' }
  const payload = await getPayload({ config: await config })
  const field = (name: string) => {
    const value = formData.get(name)
    return typeof value === 'string' ? value : ''
  }
  try {
    return await claimPlugin({
      payload,
      maintainer,
      slug: field('slug').slice(0, 200),
      note: field('note'),
      github: createGitHubAuthClient(),
    })
  } catch (err) {
    payload.logger.error({ err }, 'claim: unexpected failure')
    return { status: 'invalid', message: MESSAGES.claimFailed }
  }
}
