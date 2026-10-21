import { defaultSchema, type Options as SanitizeOptions } from 'rehype-sanitize'
import type { Element, Root, RootContent } from 'hast'

/**
 * README markdown pipeline pieces. README content is untrusted: it is parsed with raw HTML enabled
 * (READMEs use <p align>, <picture>, <details>...) and then sanitized with GitHub's own schema before
 * anything is rewritten or rendered. Order in the component: remark-gfm -> rehype-raw -> sanitize -> rehypeReadme.
 */

export type RepoRef = {
  /** "owner/repo" */
  fullName: string
  /** Falls back to HEAD (GitHub resolves it to the default branch). */
  defaultBranch?: string | null
  /** Monorepo subdirectory of the plugin; relative README URLs resolve against it. */
  path?: string | null
}

const CLOBBER_PREFIX = 'user-content-'

/** GitHub's schema (rehype-sanitize's default) plus the layout elements READMEs rely on. */
export const readmeSanitizeSchema: SanitizeOptions = {
  ...defaultSchema,
  clobberPrefix: CLOBBER_PREFIX,
  // Dropped with their text content (the default only strips <script>).
  strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'noscript', 'textarea'],
  tagNames: [...(defaultSchema.tagNames ?? []), 'picture', 'source'],
  attributes: {
    ...defaultSchema.attributes,
    // srcSet is not covered by the schema's protocol check; rehypeReadme re-validates every candidate.
    source: ['srcSet', 'media', 'type'],
    img: [...((defaultSchema.attributes?.img ?? []) as never[]).filter((a) => a !== 'longDesc'), 'srcSet'],
  },
}

const ABSOLUTE_HTTP = /^https?:\/\//i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

function safeDecode(seg: string): string {
  try {
    return decodeURIComponent(seg)
  } catch {
    return seg
  }
}

function cleanSegments(path: string): string[] {
  return path.split('/').filter((s) => s !== '' && s !== '.')
}

function encodeSegment(seg: string): string {
  try {
    return encodeURIComponent(decodeURIComponent(seg))
  } catch {
    return encodeURIComponent(seg)
  }
}

/** Resolve `rel` against the plugin directory (or the repo root for "/x"), never climbing above the repo root. */
function resolveInRepo(rel: string, pluginPath: string | null | undefined): { path: string; suffix: string } {
  const m = /^([^?#]*)([?#].*)?$/s.exec(rel)
  const pathPart = m?.[1] ?? ''
  const suffix = m?.[2] ?? ''
  const rootRelative = pathPart.startsWith('/')
  const stack: string[] = rootRelative ? [] : cleanSegments(pluginPath ?? '')
  for (const seg of cleanSegments(pathPart)) {
    // Dot segments are recognised after percent-decoding: browsers treat %2e%2e as "..".
    const decoded = safeDecode(seg).trim()
    if (decoded === '..') stack.pop()
    else if (decoded !== '.') stack.push(seg)
  }
  return { path: stack.map(encodeSegment).join('/'), suffix }
}

export type UrlKind = 'image' | 'link'

/**
 * Rewrites one URL from a README. Absolute http(s), protocol-relative and anchor URLs stay as they are;
 * other schemes (mailto:, tel:) pass through unchanged (the sanitizer already removed unsafe ones);
 * everything else is relative to the repository.
 */
export function rewriteReadmeUrl(url: string, kind: UrlKind, repo: RepoRef): string {
  const value = url.trim()
  if (value === '' || value.startsWith('#')) return value
  if (ABSOLUTE_HTTP.test(value) || value.startsWith('//') || HAS_SCHEME.test(value)) return value
  const branch = encodeURIComponent(repo.defaultBranch || 'HEAD')
  const { path, suffix } = resolveInRepo(value, repo.path)
  const tail = path ? `/${path}` : ''
  return kind === 'image'
    ? `https://raw.githubusercontent.com/${repo.fullName}/${branch}${tail}${suffix}`
    : `https://github.com/${repo.fullName}/blob/${branch}${tail}${suffix}`
}

/** srcset: rewrite every candidate URL, drop candidates whose host is not allow-listed. */
function isRelativeUrl(url: string): boolean {
  const v = url.trim()
  return !(ABSOLUTE_HTTP.test(v) || v.startsWith('//') || HAS_SCHEME.test(v))
}

function rewriteSrcSet(value: string, repo: RepoRef, relative: 'rewrite' | 'drop' = 'rewrite'): string {
  return value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .flatMap((candidate) => {
      const [url, ...descriptor] = candidate.split(/\s+/)
      if (relative === 'drop' && isRelativeUrl(url)) return []
      const rewritten = rewriteReadmeUrl(url, 'image', repo)
      const allowed = allowedReadmeImageUrl(rewritten)
      return allowed ? [[allowed, ...descriptor].join(' ')] : []
    })
    .join(', ')
}


/**
 * Hosts a README image may load from automatically. Anything else would let a plugin author observe visitors
 * (IP address, user agent) through an image beacon, so it is replaced by its alt text or a plain link.
 * `null` allows every path on the host; a function restricts the path (github.com also serves HTML pages).
 */
export const ALLOWED_README_IMAGE_HOSTS: Readonly<Record<string, ((pathname: string) => boolean) | null>> = {
  'raw.githubusercontent.com': null,
  'user-images.githubusercontent.com': null,
  'private-user-images.githubusercontent.com': null,
  'camo.githubusercontent.com': null,
  'avatars.githubusercontent.com': null,
  'opengraph.githubassets.com': null,
  'github.com': (p) =>
    /^\/user-attachments\//i.test(p) ||
    /^\/[^/]+\/[^/]+\/(raw|blob|assets)\//i.test(p) ||
    /^\/[^/]+\/[^/]+\/actions\/workflows\/[^/]+\/badge\.svg$/i.test(p),
  'img.shields.io': null,
  'shields.io': null,
  'badgen.net': null,
  'badge.fury.io': null,
  'codecov.io': null,
  'coveralls.io': null,
  'app.codacy.com': null,
  'deploy.workers.cloudflare.com': null,
  'vercel.com': (p) => /^\/button(\/|$)/i.test(p),
  'www.npmjs.com': null,
  'nodei.co': null,
}

/**
 * An (already rewritten) image URL normalised to https, or null when its host is not allow-listed.
 * Host matching is case-insensitive; `http:` and protocol-relative URLs are upgraded to https.
 */
export function allowedReadmeImageUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.trim(), 'https://invalid.invalid')
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase()
  if (!Object.hasOwn(ALLOWED_README_IMAGE_HOSTS, host)) return null
  const pathRule = ALLOWED_README_IMAGE_HOSTS[host]
  if (pathRule !== null && !pathRule(parsed.pathname)) return null
  parsed.protocol = 'https:'
  return parsed.href
}

export function isAllowedReadmeImageUrl(url: string): boolean {
  return allowedReadmeImageUrl(url) !== null
}

const EXTERNAL_REL = 'nofollow ugc noopener noreferrer'

const NO_REFERRER = 'no-referrer'
const BLOCK_TAGS = new Set(['table', 'div', 'ul', 'ol', 'pre', 'blockquote', 'details', 'hr', 'section', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'dl', 'figure'])
const ID_PREFIX = 'user-content-'

function forEachElement(node: Root | Element, fn: (el: Element) => void): void {
  for (const child of node.children) {
    if (child.type === 'element') {
      fn(child)
      forEachElement(child, fn)
    }
  }
}

function textContent(node: Root | Element): string {
  let out = ''
  for (const child of node.children) {
    if (child.type === 'text') out += child.value
    else if (child.type === 'element') out += textContent(child)
  }
  return out
}

/** GitHub-style heading slug: lowercase, punctuation dropped, spaces to hyphens. */
function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '')
    .replace(/\s/g, '-')
}

/**
 * Sanitize prefixed every author id (`user-content-`). Headings without an id get one like GitHub's, and every
 * in-page `#anchor` is pointed at the prefixed id it targets (case-insensitively), so tables of contents and
 * footnotes keep working while README ids can never collide with page ids.
 */
function resolveAnchors(tree: Root): void {
  const ids = new Map<string, string>() // lowercased -> actual
  forEachElement(tree, (el) => {
    if (typeof el.properties.id === 'string') ids.set(el.properties.id.toLowerCase(), el.properties.id)
    // <a name="x"> is a valid fragment target too (the sanitizer prefixes name like id).
    if (el.tagName === 'a' && typeof el.properties.name === 'string') ids.set(el.properties.name.toLowerCase(), el.properties.name)
  })
  const used = new Map<string, number>()
  forEachElement(tree, (el) => {
    if (!/^h[1-6]$/.test(el.tagName) || el.properties.id) return
    const base = slugify(textContent(el))
    if (!base) return
    const n = used.get(base) ?? 0
    used.set(base, n + 1)
    const id = `${ID_PREFIX}${n === 0 ? base : `${base}-${n}`}`
    el.properties.id = id
    ids.set(id.toLowerCase(), id)
  })
  forEachElement(tree, (el) => {
    const href = el.tagName === 'a' ? el.properties.href : undefined
    if (typeof href !== 'string' || !href.startsWith('#') || href.length < 2) return
    const frag = safeDecode(href.slice(1))
    const target = ids.get(`${ID_PREFIX}${frag}`.toLowerCase()) ?? ids.get(frag.toLowerCase()) ?? `${ID_PREFIX}${frag}`
    el.properties.href = `#${encodeURIComponent(target).replace(/%3A/gi, ':')}`
  })
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** What replaces a blocked image: its alt text, or a plain "[image]" link to the original (text only inside a link). */
function blockedImage(el: Element, original: string, inAnchor: boolean): RootContent {
  const alt = textOf(el.properties.alt)
  if (alt) return { type: 'text', value: alt }
  if (inAnchor || !ABSOLUTE_HTTP.test(original)) return { type: 'text', value: '[image]' }
  return {
    type: 'element',
    tagName: 'a',
    properties: { href: original, rel: EXTERNAL_REL, target: '_blank' },
    children: [{ type: 'text', value: '[image]' }],
  }
}

/**
 * rehype plugin, run AFTER sanitize: rewrites relative URLs, blocks images from hosts that are not allow-listed,
 * hardens links and images, demotes headings (the page already has its own h1) and keeps task-list checkboxes inert.
 */
export type RehypeReadmeOptions = {
  /** Demote h1-h5 by one level (write time). Off on read: stored headings were demoted already. */
  demoteHeadings?: boolean
  /** Relative URLs: rewrite against the repository (write time) or drop them (read time; none should exist). */
  relative?: 'rewrite' | 'drop'
}

export function rehypeReadme(repo: RepoRef, options: RehypeReadmeOptions = {}) {
  const { demoteHeadings = true, relative = 'rewrite' } = options
  const visit = (parent: Root | Element, inAnchor: boolean): void => {
    const next: RootContent[] = []
    for (const child of parent.children) {
      if (child.type !== 'element') {
        next.push(child)
        continue
      }
      const props = child.properties
      const tag = child.tagName
      // Only GFM task-list checkboxes (inside an <li>, or its loose-list <p>) survive; a stray <input> is removed.
      if (tag === 'input' && !(parent.type === 'element' && (parent.tagName === 'li' || parent.tagName === 'p'))) continue
      if (tag === 'img') {
        const original = typeof props.src === 'string' ? props.src : ''
        const src = original && !(relative === 'drop' && isRelativeUrl(original)) ? rewriteReadmeUrl(original, 'image', repo) : ''
        const allowedSrc = src ? allowedReadmeImageUrl(src) : null
        if (!allowedSrc) {
          next.push(blockedImage(child, original, inAnchor))
          continue
        }
        props.src = allowedSrc
        if (typeof props.srcSet === 'string') {
          const srcSet = rewriteSrcSet(props.srcSet, repo, relative)
          if (srcSet) props.srcSet = srcSet
          else delete props.srcSet
        }
        props.loading = 'lazy'
        props.decoding = 'async'
        props.referrerPolicy = NO_REFERRER
      } else if (tag === 'source') {
        const srcSet = typeof props.srcSet === 'string' ? rewriteSrcSet(props.srcSet, repo, relative) : ''
        if (!srcSet) continue
        props.srcSet = srcSet
        props.referrerPolicy = NO_REFERRER
      } else if (tag === 'a') {
        const href = typeof props.href === 'string' ? props.href : undefined
        if (href && !href.startsWith('#')) {
          props.href = relative === 'drop' && isRelativeUrl(href) ? '' : rewriteReadmeUrl(href, 'link', repo)
          if (props.href === '') delete props.href
          props.rel = EXTERNAL_REL
          if (ABSOLUTE_HTTP.test(String(props.href)) || String(props.href).startsWith('//')) props.target = '_blank'
        }
      } else if (tag === 'input') {
        props.disabled = true
      } else if (demoteHeadings && /^h[1-5]$/.test(tag)) {
        child.tagName = `h${Number(tag[1]) + 1}`
      }
      visit(child, inAnchor || tag === 'a')
      // Unwrapped foreign content can leave a block inside a <p>; browsers would split it and hydration would differ.
      if (tag === 'p' && child.children.some((c) => c.type === 'element' && BLOCK_TAGS.has(c.tagName))) child.tagName = 'div'
      next.push(child)
    }
    parent.children = next as typeof parent.children
  }
  return (tree: Root) => {
    visit(tree, false)
    resolveAnchors(tree)
  }
}

/** Deepest element depth (root children = 1) of a hast tree. Iterative (no recursion); stops early above `limit`. */
export function maxTreeDepth(tree: Root, limit = Infinity): number {
  let max = 0
  const stack: { node: Root | Element; depth: number }[] = [{ node: tree, depth: 0 }]
  while (stack.length) {
    const { node, depth } = stack.pop() as { node: Root | Element; depth: number }
    if (depth > max) max = depth
    if (max > limit) return max
    for (const child of node.children) if (child.type === 'element') stack.push({ node: child, depth: depth + 1 })
  }
  return max
}

/** Deepest element nesting allowed in rendered or stored README HTML. */
export const README_MAX_TREE_DEPTH = 64

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/**
 * Deepest open raw-HTML element stack, counting every non-void start tag whatever its name (code is already removed;
 * this is a cheap early exit, the authoritative check is maxTreeDepth on the final tree). A start
 * tag of a non-void element opens (`<div/>` too: HTML ignores the slash on non-void elements); an end tag closes only
 * a matching open element. Linear: every step advances.
 */
export function maxHtmlNesting(source: string, limit: number): number {
  const stack: string[] = []
  let max = 0
  let i = source.indexOf('<')
  let close = -1
  while (i !== -1) {
    if (close < i) close = source.indexOf('>', i)
    if (close === -1) break
    const next = source.indexOf('<', i + 1)
    if (next !== -1 && next < close) {
      i = next
      continue
    }
    const m = /^(\/?)([a-zA-Z][a-zA-Z0-9-]*)/.exec(source.slice(i + 1, close))
    if (m) {
      const name = m[2].toLowerCase()
      if (m[1]) {
        const at = stack.lastIndexOf(name)
        if (at !== -1) stack.length = at
      } else if (!VOID_TAGS.has(name)) {
        stack.push(name)
        if (stack.length > max) max = stack.length
        if (max > limit) return max
      }
    }
    i = next
  }
  return max
}

