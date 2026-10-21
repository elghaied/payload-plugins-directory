import { parseBadgeFile, templateBadgeResponse } from '@/lib/badge'
import { isValidSlug } from '@/lib/cacheTags'
import { getServerURL } from '@/lib/serverUrl'
import { getTemplateDetail } from '@/lib/templates/queries'

export const dynamic = 'force-dynamic'

/** GET /badge/templates/<slug>.svg — same caching as the plugin badge. */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params
  const slug = parseBadgeFile(file)
  // getTemplateDetail only resolves listed slugs (null for unknown, hidden or trashed).
  const template = slug && isValidSlug(slug) ? await getTemplateDetail(slug) : null
  return templateBadgeResponse({ template, origin: getServerURL() })
}
