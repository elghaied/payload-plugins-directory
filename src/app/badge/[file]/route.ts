import { badgeResponse, parseBadgeFile } from '@/lib/badge'
import { isValidSlug } from '@/lib/cacheTags'
import { getPluginDetail } from '@/lib/directory/queries'
import { getServerURL } from '@/lib/serverUrl'

export const dynamic = 'force-dynamic'

/** GET /badge/<slug>.svg — Cloudflare caches it for ~6 h via Cache-Control. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const slug = parseBadgeFile(file)
  // getPluginDetail only resolves listed slugs (backed by the cached summaries), so probing random
  // slugs creates no per-slug cache entries and never reveals hidden or trashed plugins.
  const plugin = slug && isValidSlug(slug) ? await getPluginDetail(slug) : null
  // Public URLs come only from getServerURL(); empty means the badge renders unlinked.
  return badgeResponse({ plugin, origin: getServerURL() })
}
