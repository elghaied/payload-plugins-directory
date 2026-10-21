import { NextResponse } from 'next/server'
import { getServerURL, isProductionSite } from '@/lib/serverUrl'

/** Non-production deployments (previews, local) send `X-Robots-Tag: noindex` on every response. */
export function proxy() {
  const res = NextResponse.next()
  if (!isProductionSite(getServerURL())) res.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return res
}

export const config = {
  // /api/mcp is excluded on purpose: Next buffers up to 10 MB of the body of every proxied request before the route
  // runs, but that endpoint caps its own body at 16 KB (src/mcp/guard.ts), and the noindex header means nothing on JSON-RPC.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/mcp).*)'],
}
