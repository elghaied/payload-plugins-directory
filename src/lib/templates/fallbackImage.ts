import { allowedReadmeImageUrl } from '@/lib/directory/markdown'

const TAG = /<(\/?)(a|img)\b([^>]*)>/gi
const MAX_URL_CHARS = 2_000
/** Deploy buttons and badges are never a template's picture (Ruling 11). */
const NOT_A_PICTURE = /deploy|button|badge|shield/i
const MIN_EXPLICIT_PX = 200

const decodeAttribute = (value: string) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')

function attribute(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attrs)
  return m ? decodeAttribute((m[1] ?? m[2] ?? m[3] ?? '').trim()) : null
}

/** An explicit pixel width or height (`120`, `120px`) under 200; percentages and missing values pass. */
function tooSmall(attrs: string): boolean {
  return ['width', 'height'].some((name) => {
    const m = /^(\d+)(?:px)?$/i.exec(attribute(attrs, name) ?? '')
    return m !== null && Number(m[1]) < MIN_EXPLICIT_PX
  })
}

const textOf = (html: string) => decodeAttribute(html.replace(/<[^>]*>/g, ' '))

/**
 * The first `<img src="https://…">` of sanitized README HTML that is a picture of the template, else null: its host is on
 * the README image allow-list, and neither its alt, its src nor its enclosing link (href or text) looks like a deploy
 * button or badge, and it has no explicit width or height under 200 px. Stored as a template's `fallbackImageUrl` (the
 * card image when the owner added no screenshot); re-checked on read.
 */
export function firstReadmeImage(html: string | null | undefined): string | null {
  if (!html) return null
  let link: { href: string; text: string } | null = null
  for (const match of html.matchAll(TAG)) {
    const [whole, closing, tag, attrs] = match
    if (tag.toLowerCase() === 'a') {
      if (closing) {
        link = null
      } else {
        const start = match.index + whole.length
        const end = html.toLowerCase().indexOf('</a', start)
        link = { href: attribute(attrs, 'href') ?? '', text: textOf(html.slice(start, end === -1 ? undefined : end)) }
      }
      continue
    }
    if (closing) continue
    const src = attribute(attrs, 'src') ?? ''
    if (!src.startsWith('https://') || src.length > MAX_URL_CHARS) continue
    const hints = [src, attribute(attrs, 'alt') ?? '', link?.href ?? '', link?.text ?? '']
    if (hints.some((h) => NOT_A_PICTURE.test(h)) || tooSmall(attrs)) continue
    const allowed = allowedReadmeImageUrl(src)
    if (allowed) return allowed
  }
  return null
}
