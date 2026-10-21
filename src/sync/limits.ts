import { NO_DESCRIPTION } from '@/lib/directory/tagline'
import type { ExtractedPlugin } from './extract'
import type { ExtractedTemplate } from './templates/extract'

/**
 * Payload 4 enforces `config.defaultMaxTextLength` (40,000) on every text/textarea field without its own
 * `maxLength`, and one invalid field fails the whole repository sync. Everything sync writes from external data
 * is therefore clamped here, before it is hashed and saved.
 */
export const README_MAX_CHARS = 100_000
/** The README is cut at a newline when one falls within this many characters of the limit. */
const README_NEWLINE_WINDOW = 2_000
export const DESCRIPTION_MAX_CHARS = 2_000
export const NAME_MAX_CHARS = 200
export const PACKAGE_NAME_MAX_CHARS = 214
export const URL_MAX_CHARS = 2_000
export const PATH_MAX_CHARS = 500
export const VERSION_RANGE_MAX_CHARS = 200
export const KEYWORD_MAX_CHARS = 100
export const KEYWORDS_MAX = 50

/** `text` cut to at most `max` characters, never splitting a surrogate pair. */
export function clampChars(text: string, max: number): string {
  if (text.length <= max) return text
  let end = max
  const last = text.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return text.slice(0, end)
}

/** A README of at most README_MAX_CHARS: cut at the last newline in the final 2,000 characters, else hard. */
export function truncateReadme(readme: string, max = README_MAX_CHARS): string {
  if (readme.length <= max) return readme
  const cut = clampChars(readme, max)
  const newline = cut.lastIndexOf('\n')
  return newline > 0 && newline >= cut.length - README_NEWLINE_WINDOW ? cut.slice(0, newline) : cut
}

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? clampChars(v, max) : undefined)

/** Every text field of an extracted plugin bounded (and non-strings from a hostile package.json dropped). */
export function clampExtracted(p: ExtractedPlugin): ExtractedPlugin {
  const keywords = (Array.isArray(p.keywords) ? p.keywords : [])
    .filter((k): k is string => typeof k === 'string')
    .slice(0, KEYWORDS_MAX)
    .map((k) => clampChars(k, KEYWORD_MAX_CHARS))
  return {
    ...p,
    name: str(p.name, NAME_MAX_CHARS) ?? '',
    packageName: str(p.packageName, PACKAGE_NAME_MAX_CHARS),
    path: str(p.path, PATH_MAX_CHARS),
    url: str(p.url, URL_MAX_CHARS) ?? '',
    description: str(p.description, DESCRIPTION_MAX_CHARS) || NO_DESCRIPTION,
    payloadVersionRange: str(p.payloadVersionRange, VERSION_RANGE_MAX_CHARS) ?? null,
    readme: typeof p.readme === 'string' ? truncateReadme(p.readme) : undefined,
    keywords,
  }
}

/** Every text field of an extracted template bounded, like `clampExtracted` (template extraction is untrusted too). */
export function clampExtractedTemplate(t: ExtractedTemplate): ExtractedTemplate {
  return {
    ...t,
    name: str(t.name, NAME_MAX_CHARS) || t.slug,
    path: str(t.path, PATH_MAX_CHARS) ?? null,
    url: str(t.url, URL_MAX_CHARS) ?? '',
    description: str(t.description, DESCRIPTION_MAX_CHARS) || NO_DESCRIPTION,
    payloadVersionRange: str(t.payloadVersionRange, VERSION_RANGE_MAX_CHARS) ?? null,
    readme: typeof t.readme === 'string' ? truncateReadme(t.readme) : undefined,
  }
}
