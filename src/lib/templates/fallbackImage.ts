import { allowedReadmeImageUrl } from '@/lib/directory/markdown'

const IMG_SRC = /<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const MAX_URL_CHARS = 2_000

const decodeAttribute = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

/**
 * The first `<img src="https://…">` of sanitized README HTML whose host is on the README image allow-list, else null.
 * Stored as a template's `fallbackImageUrl` (the card image when the owner added no screenshot); re-checked on read.
 */
export function firstReadmeImage(html: string | null | undefined): string | null {
  if (!html) return null
  for (const match of html.matchAll(IMG_SRC)) {
    const src = decodeAttribute((match[1] ?? match[2] ?? '').trim())
    if (!src.startsWith('https://') || src.length > MAX_URL_CHARS) continue
    const allowed = allowedReadmeImageUrl(src)
    if (allowed) return allowed
  }
  return null
}
