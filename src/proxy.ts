import { NextResponse } from 'next/server'
import { getServerURL, isProductionSite } from '@/lib/serverUrl'

/** Non-production deployments (staging, local) send `X-Robots-Tag: noindex` on every response. */
export function proxy() {
  const res = NextResponse.next()
  if (!isProductionSite(getServerURL())) res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
