import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { toHtml } from 'hast-util-to-html'
import type { Root } from 'hast'
import { README_HTML_MAX_CHARS, README_MARKDOWN_MAX } from './readmeLimits'
import { readmeSanitizeSchema, rehypeReadme, type RepoRef } from './markdown'

/**
 * README Markdown -> sanitized HTML. Runs ONLY in the worker process at sync time (and the backfill CLI), inside an
 * isolated worker thread with memory and time limits (renderReadmeIsolated.ts): the Markdown parsers have inputs
 * that exhaust memory or CPU, so it never runs in the web process. Imports here must stay relative (the worker
 * thread loads this file through tsx without the project's path aliases).
 */

/** Deepest blockquote / list / HTML nesting rendered as Markdown. Deeper input is stored as plain text (null HTML). */
export const README_MAX_NESTING = 20
/** Most table body cells (columns x rows, summed over the README) rendered as Markdown. */
export const README_MAX_TABLE_CELLS = 20_000
/** Share of characters that may be inline-delimiter characters before the README is treated as plain text. */
export const README_MAX_DELIMITER_DENSITY = 0.3

const DELIMITERS = new Set(['*', '_', '[', ']', '!', '~'])
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

/**
 * Deepest open raw-HTML element stack. A start tag of a non-void element opens (`<div/>` too: HTML ignores the
 * slash on non-void elements); an end tag closes only a matching open element. Linear: every step advances.
 */
function maxHtmlNesting(source: string, limit: number): number {
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

/** Cells (columns x body rows) of every GFM table, summed. Linear scan over the lines. */
function tableCells(source: string): number {
  const lines = source.split('\n')
  let cells = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.indexOf('-') === -1 || line.indexOf('|') === -1 || !/^[\s|:-]+$/.test(line)) continue
    let pipes = 0
    for (let k = 0; k < line.length; k++) if (line.charCodeAt(k) === 124) pipes++
    let rows = 0
    for (let j = i + 1; j < lines.length && lines[j].trim() !== ''; j++) rows++
    cells += (pipes + 1) * Math.max(rows, 1)
    if (cells > README_MAX_TABLE_CELLS) return cells
  }
  return cells
}

function delimiterDensity(source: string): number {
  if (!source.length) return 0
  let n = 0
  for (let i = 0; i < source.length; i++) if (DELIMITERS.has(source[i])) n++
  return n / source.length
}

/** True when the source nests deeply enough to make the Markdown/HTML parsers slow or recursive. */
export function isPathologicallyNested(source: string, limit = README_MAX_NESTING): boolean {
  return maxBlockNesting(source) > limit || maxHtmlNesting(source, limit) > limit
}

/** Why a README is rendered as plain text without even trying to parse it, or null when it may be parsed. */
export function readmeRenderBlocker(source: string): string | null {
  if (isPathologicallyNested(source)) return 'nesting'
  if (tableCells(source) > README_MAX_TABLE_CELLS) return 'table'
  if (delimiterDensity(source) > README_MAX_DELIMITER_DENSITY) return 'delimiters'
  return null
}

/**
 * The sanitized, URL-rewritten HTML of a README, or null when it must stay plain text: refused by a cheap pre-parse
 * cap, any parser error (including stack overflow), or output over README_HTML_MAX_CHARS. Never throws. The output
 * is safe to embed: `rehype-sanitize` (GitHub's schema) runs before the tree is serialised.
 */
export function renderReadmeHtml(source: string, repo: RepoRef): string | null {
  try {
    const text = source.length > README_MARKDOWN_MAX ? source.slice(0, README_MARKDOWN_MAX) : source
    if (readmeRenderBlocker(text)) return null
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      // Empty prefix: the sanitizer adds user-content- to every id once; resolveAnchors points links at those ids.
      .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
      .use(rehypeRaw)
      .use(rehypeSanitize, readmeSanitizeSchema)
      .use(rehypeReadme, repo)
    const tree = processor.runSync(processor.parse(text)) as Root
    const html = toHtml(tree)
    return html.length > README_HTML_MAX_CHARS ? null : html
  } catch {
    return null
  }
}
