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
  clobber: ['name', 'id'],
  // Dropped with their text content (the default only strips <script>).
  strip: [...(defaultSchema.strip ?? []), 'style', 'iframe', 'noscript', 'textarea'],
  tagNames: [...(defaultSchema.tagNames ?? []), 'picture', 'source'],
  attributes: {
    ...defaultSchema.attributes,
    // srcSet is not covered by the schema's protocol check; rehypeReadme re-validates every candidate.
    source: ['srcSet', 'media', 'type'],
    img: [...((defaultSchema.attributes?.img as never[]) ?? []), 'srcSet'],
  },
}

const ABSOLUTE_HTTP = /^https?:\/\//i
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i

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
    if (seg === '..') stack.pop()
    else stack.push(seg)
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
function rewriteSrcSet(value: string, repo: RepoRef): string {
  return value
    .split(',')
    .map((c) => c.trim())
    .filter(Boolean)
    .flatMap((candidate) => {
      const [url, ...descriptor] = candidate.split(/\s+/)
      const rewritten = rewriteReadmeUrl(url, 'image', repo)
      return isAllowedReadmeImageUrl(rewritten) ? [[rewritten, ...descriptor].join(' ')] : []
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
  'github.com': (p) => /^\/user-attachments\//i.test(p) || /^\/[^/]+\/[^/]+\/(raw|blob)\//i.test(p),
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

/** True when an (already rewritten) image URL points at an allow-listed host. Host matching is case-insensitive. */
export function isAllowedReadmeImageUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url.trim(), 'https://invalid.invalid')
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false
  const host = parsed.hostname.toLowerCase()
  if (!Object.hasOwn(ALLOWED_README_IMAGE_HOSTS, host)) return false
  const pathRule = ALLOWED_README_IMAGE_HOSTS[host]
  return pathRule === null || pathRule(parsed.pathname)
}

const EXTERNAL_REL = 'nofollow ugc noopener noreferrer'

const NO_REFERRER = 'no-referrer'

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
export function rehypeReadme(repo: RepoRef) {
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
        const src = original ? rewriteReadmeUrl(original, 'image', repo) : ''
        if (!src || !isAllowedReadmeImageUrl(src)) {
          next.push(blockedImage(child, original, inAnchor))
          continue
        }
        props.src = src
        if (typeof props.srcSet === 'string') {
          const srcSet = rewriteSrcSet(props.srcSet, repo)
          if (srcSet) props.srcSet = srcSet
          else delete props.srcSet
        }
        props.loading = 'lazy'
        props.decoding = 'async'
        props.referrerPolicy = NO_REFERRER
      } else if (tag === 'source') {
        const srcSet = typeof props.srcSet === 'string' ? rewriteSrcSet(props.srcSet, repo) : ''
        if (!srcSet) continue
        props.srcSet = srcSet
        props.referrerPolicy = NO_REFERRER
      } else if (tag === 'a') {
        const href = typeof props.href === 'string' ? props.href : undefined
        if (href && !href.startsWith('#')) {
          props.href = rewriteReadmeUrl(href, 'link', repo)
          props.rel = EXTERNAL_REL
          if (ABSOLUTE_HTTP.test(String(props.href))) props.target = '_blank'
        }
      } else if (tag === 'input') {
        props.disabled = true
      } else if (/^h[1-5]$/.test(tag)) {
        child.tagName = `h${Number(tag[1]) + 1}`
      }
      visit(child, inAnchor || tag === 'a')
      next.push(child)
    }
    parent.children = next as typeof parent.children
  }
  return (tree: Root) => visit(tree, false)
}
