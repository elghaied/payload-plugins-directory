import { validateTaxonomySlug } from '@/taxonomy/slugs'
import { LIMITS } from './schema'
import type { CleanEnrichment, TagRef } from './types'

const MD_LINK = /!?\[([^\]]*)\]\([^)]*\)/g
const HTML_TAG = /<\/?[a-zA-Z][^>]*>/g
const EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g
const URL = /\b(?:https?:\/\/|www\.)\S+/gi
// Bare domains the model might echo from a README ("visit evil.com"). Code-ish names (Next.js, *.ts) are kept.
const DOMAIN =
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|co|xyz|ai|me|info|biz|ru|cn|ly|gg|sh|link|site|online|top)\b\S*/gi
const MD_MARKS = /\*\*|__|`+|^\s*#+\s*|^\s*>\s*/gm
// C0/C1 controls (except tab, LF, CR, which are whitespace), soft hyphen, zero-width characters, bidi marks,
// overrides and isolates, word joiner, BOM, Arabic letter mark.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u061C\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g
// Unpaired surrogates (they cannot be encoded to UTF-8 and break clamping).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g

const hasLink = (s: string) => new RegExp(`${EMAIL.source}|${URL.source}|${DOMAIN.source}`, 'i').test(s)

// Scheme-shaped only: prose such as "user data: name" or "JavaScript: the language" is left alone.
const SCHEME = /\b(?:java\s*script|vbscript)\s*:(?=\S)|\bdata\s*:\s*[a-z]+\/[a-z0-9.+-]+\S*/gi

function stripOnce(s: string): string {
  return s
    .replace(MD_LINK, '$1')
    .replace(HTML_TAG, '')
    .replace(HTML_TAG, '')
    // Before the link filters, so "evil<>.com" cannot reassemble after they ran.
    .replace(/[<>]/g, '')
    .replace(EMAIL, '')
    .replace(URL, '')
    .replace(MD_MARKS, '')
    .replace(DOMAIN, '')
    .replace(SCHEME, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Strips until stable (one pass can leave residue: "<<b>script>", "evil.**com"), then drops stray angle brackets. */
function strip(s: string): string {
  let current = s
  for (let i = 0; i < 5; i++) {
    const next = stripOnce(current)
    if (next === current) break
    current = next
  }
  return current.replace(/[<>]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Plain text for display (spec §5.3): no HTML, markdown links, URLs, domains or e-mail addresses; no control or
 * bidi characters; whitespace collapsed; clamped to `max` characters at a word boundary with "…" (never splitting
 * a surrogate pair).
 */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  // Bound the work an adversarial input can cause before any normalisation or regex runs.
  const base = value.slice(0, max * 4).normalize('NFKC').replace(LONE_SURROGATE, ' ')
  const spaced = base.replace(INVISIBLE, ' ')
  const joined = base.replace(INVISIBLE, '')
  // Zero-width characters must not hide a link from the filters ("evil\u200B.com").
  let s = strip(hasLink(joined) && !hasLink(spaced) ? joined : spaced)
  if (s.length > max) {
    let cut = s.slice(0, max - 1)
    if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1)
    const space = cut.lastIndexOf(' ')
    s = `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:.\-–]+$/, '')}…`
  }
  return s
}

export function slugifyTag(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Symbols that distinguish names become words: c++ -> cpp, c# -> csharp, .net -> dotnet.
    .replace(/(?<=[a-z0-9])\+\+/g, 'pp')
    .replace(/(?<=[a-z0-9])\+/g, 'plus')
    .replace(/(?<=[a-z0-9])#/g, 'sharp')
    .replace(/(^|\s)\.(?=[a-z0-9])/g, '$1dot')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
}

function cleanList(value: unknown, maxLength: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value.slice(0, 50)) {
    const text = cleanText(item, maxLength)
    if (text && !out.some((o) => o.toLowerCase() === text.toLowerCase())) out.push(text)
    if (out.length === maxItems) break
  }
  return out
}

export type ValidationContext = { leafSlugs: ReadonlySet<string>; tags: readonly TagRef[]; maxNewTags: number }
export type ValidationResult = { ok: true; value: CleanEnrichment } | { ok: false; error: string }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const field = (o: Record<string, unknown>, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined)

/** Re-validates a model answer before anything is saved (spec §5.3). Reads only the seven contract keys. */
export function validateEnrichment(raw: unknown, ctx: ValidationContext): ValidationResult {
  if (!isRecord(raw)) return { ok: false, error: 'invalid-output: not an object' }
  const rawCategory = field(raw, 'category')
  const requested = typeof rawCategory === 'string' ? rawCategory.trim() : ''
  let category = requested
  if (!ctx.leafSlugs.has(category)) {
    if (!ctx.leafSlugs.has('other')) return { ok: false, error: `invalid-output: unknown category "${requested.slice(0, 60)}"` }
    category = 'other'
  }
  const rawConfidence = field(raw, 'confidence')
  const confidence =
    typeof rawConfidence === 'number' && Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0
  const tagline = cleanText(field(raw, 'tagline'), LIMITS.tagline)
  const summary = cleanText(field(raw, 'summary'), LIMITS.summary)
  if (!tagline || !summary) return { ok: false, error: 'invalid-output: empty tagline or summary' }
  const features = cleanList(field(raw, 'features'), LIMITS.featureLength, LIMITS.featuresMax)
  const useCases = cleanList(field(raw, 'useCases'), LIMITS.useCaseLength, LIMITS.useCasesMax)
  if (features.length === 0 || useCases.length === 0) return { ok: false, error: 'invalid-output: no features or use cases' }
  return {
    ok: true,
    value: { category, tags: resolveTags(field(raw, 'tags'), ctx), tagline, summary, features, useCases, confidence },
  }
}

const TITLE_CHARS = /^[A-Za-z0-9 .+#/-]+$/

/** A new tag title the model proposed, or null when it is not acceptable (rejected, never repaired). */
function cleanNewTitle(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const title = value.slice(0, 100).normalize('NFKC').replace(/\s+/g, ' ').trim()
  if (!title || title.length > LIMITS.tagTitle || !TITLE_CHARS.test(title)) return null
  if (title.split(' ').length > LIMITS.tagTitleWords) return null
  // Links, domains and markdown that pass the character set ("evil.com") are not titles.
  if (cleanText(title, LIMITS.tagTitle) !== title) return null
  return title
}

function resolveTags(value: unknown, ctx: ValidationContext): CleanEnrichment['tags'] {
  const index = new Map<string, string>()
  const add = (key: string, slug: string) => {
    const lower = key.trim().toLowerCase()
    if (lower && !index.has(lower)) index.set(lower, slug)
    const slugged = slugifyTag(key)
    if (slugged && !index.has(slugged)) index.set(slugged, slug)
  }
  for (const t of ctx.tags) for (const key of [t.slug, t.title, ...t.aliases]) add(key, t.slug)
  const lookup = (text: string) => index.get(text.trim().toLowerCase()) ?? index.get(slugifyTag(text))

  const maxNew = Number.isFinite(ctx.maxNewTags) ? Math.max(0, Math.floor(ctx.maxNewTags)) : 0
  const existing: string[] = []
  const created: { slug: string; title: string }[] = []
  const taken = new Set<string>()

  for (const item of Array.isArray(value) ? value.slice(0, 30) : []) {
    if (existing.length + created.length >= LIMITS.tagsMax) break
    if (typeof item === 'string') {
      const slug = lookup(item)
      if (slug && !taken.has(slug)) {
        taken.add(slug)
        existing.push(slug)
      }
      continue
    }
    if (!isRecord(item)) continue
    const title = cleanNewTitle(field(item, 'new'))
    if (!title) continue
    const slug = slugifyTag(title)
    const known = lookup(title)
    if (known) {
      if (!taken.has(known)) {
        taken.add(known)
        existing.push(known)
      }
      continue
    }
    if (created.length >= maxNew || taken.has(slug) || validateTaxonomySlug(slug) !== true) continue
    taken.add(slug)
    created.push({ slug, title })
  }
  return { existing, created }
}
