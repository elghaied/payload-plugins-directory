import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import type { Root } from 'hast'
import { readmeSanitizeSchema, rehypeReadme, type RepoRef } from './markdown'

/** Longest README (characters) rendered as Markdown; the page links to GitHub for the rest. */
export const README_MARKDOWN_MAX = 60_000
/** Deepest blockquote / list / HTML nesting rendered as Markdown. Deeper input is rendered as plain text. */
export const README_MAX_NESTING = 20
/** Bump when the pipeline or sanitizer schema changes: it is part of the render cache key. */
export const README_RENDER_VERSION = 'v1'

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/** Deepest blockquote/list nesting on any line: leading `>` markers + list markers + list indentation. Linear. */
function maxBlockNesting(source: string): number {
  let max = 0
  let start = 0
  const n = source.length
  while (start <= n) {
    let end = source.indexOf('\n', start)
    if (end === -1) end = n
    let i = start
    let indent = 0
    let quotes = 0
    let markers = 0
    let sawMarker = false
    while (i < end) {
      const c = source.charCodeAt(i)
      if (c === 32 || c === 9) {
        if (!sawMarker && quotes === 0 && markers === 0) indent += c === 9 ? 4 : 1
        i++
      } else if (c === 62) {
        quotes++
        i++
      } else if ((c === 45 || c === 42 || c === 43) && (source.charCodeAt(i + 1) === 32 || source.charCodeAt(i + 1) === 9)) {
        markers++
        sawMarker = true
        i += 2
      } else if (c >= 48 && c <= 57) {
        let j = i
        while (j < end && j - i < 10 && source.charCodeAt(j) >= 48 && source.charCodeAt(j) <= 57) j++
        const d = source.charCodeAt(j)
        if ((d === 46 || d === 41) && (source.charCodeAt(j + 1) === 32 || source.charCodeAt(j + 1) === 9)) {
          markers++
          sawMarker = true
          i = j + 2
        } else break
      } else break
    }
    const depth = quotes + markers + (markers > 0 ? Math.floor(indent / 2) : 0)
    if (depth > max) max = depth
    start = end + 1
  }
  return max
}

/** Deepest open raw-HTML element stack. Linear: every step advances past the character it examined. */
function maxHtmlNesting(source: string): number {
  let depth = 0
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
      const selfClosing = source.charCodeAt(close - 1) === 47
      if (m[1]) depth = Math.max(0, depth - 1)
      else if (!VOID_TAGS.has(name) && !selfClosing) {
        depth++
        if (depth > max) max = depth
      }
    }
    i = next
  }
  return max
}

/** True when the source nests deeply enough to make the Markdown/HTML parsers slow or recursive. */
export function isPathologicallyNested(source: string, limit = README_MAX_NESTING): boolean {
  return maxBlockNesting(source) > limit || maxHtmlNesting(source) > limit
}

function stripPositions(node: unknown): void {
  const n = node as { position?: unknown; children?: unknown[] }
  delete n.position
  if (Array.isArray(n.children)) for (const c of n.children) stripPositions(c)
}

/**
 * The sanitized, URL-rewritten hast tree of a README, or null when it must be shown as plain text: too deeply
 * nested, or any parser error (including stack overflow). Never throws. The tree is plain JSON (cacheable).
 */
export function renderReadmeTree(source: string, repo: RepoRef): Root | null {
  try {
    const text = source.length > README_MARKDOWN_MAX ? source.slice(0, README_MARKDOWN_MAX) : source
    if (isPathologicallyNested(text)) return null
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      // Empty prefix: the sanitizer adds user-content- to every id once; resolveAnchors points links at those ids.
      .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
      .use(rehypeRaw)
      .use(rehypeSanitize, readmeSanitizeSchema)
      .use(rehypeReadme, repo)
    const tree = processor.runSync(processor.parse(text)) as Root
    stripPositions(tree)
    return tree
  } catch {
    return null
  }
}
