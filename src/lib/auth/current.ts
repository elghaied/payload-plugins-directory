import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import type { Maintainer } from '@/payload-types'
import { sanitizeReturnTo } from './oauth'

export type CurrentMaintainer = Maintainer & { collection: 'maintainers' }

/** The signed-in maintainer for this request (RSC or server action), via Payload's auth strategies. */
export async function getCurrentMaintainer(): Promise<CurrentMaintainer | null> {
  const payload = await getPayload({ config: await config })
  const { user } = await payload.auth({ headers: await headers() })
  return user?.collection === 'maintainers' ? (user as CurrentMaintainer) : null
}

export async function requireMaintainer(returnTo: string): Promise<CurrentMaintainer> {
  const maintainer = await getCurrentMaintainer()
  if (!maintainer) redirect(`/auth/github?returnTo=${encodeURIComponent(sanitizeReturnTo(returnTo))}`)
  return maintainer
}
