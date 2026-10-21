import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { toHtml } from 'hast-util-to-html'
import type { Root } from 'hast'
import { README_HTML_MAX_CHARS, README_MARKDOWN_MAX } from './readmeLimits'
import { README_MAX_TREE_DEPTH, maxHtmlNesting, maxTreeDepth, readmeSanitizeSchema, rehypeReadme, type RepoRef } from './markdown'

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
/** Deepest emphasis nesting (unmatched `*`/`_` openers within a paragraph) rendered as Markdown. */
export const README_MAX_EMPHASIS_DEPTH = 20
/** Share of characters that may be inline-delimiter characters before the README is treated as plain text. */
export const README_MAX_DELIMITER_DENSITY = 0.3

const DELIMITERS = new Set(['*', '_', '[', ']', '!', '~'])

/** The source without fenced code blocks and inline code spans: what the nesting and emphasis scans should look at. */
function withoutCode(source: string): string {
  const lines = source.split('\n')
  const kept: string[] = []
  let fence: { char: string; len: number } | null = null
  for (const line of lines) {
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence.char && m[1].length >= fence.len && line.slice(m[0].length).trim() === '') fence = null
      continue
    }
    if (m) {
      fence = { char: m[1][0], len: m[1].length }
      continue
    }
    kept.push(line)
  }
  return stripInlineCode(kept.join('\n'))
}

/** Removes `code` spans: an opening backtick run is closed by the next run of exactly the same length. Linear. */
function stripInlineCode(text: string): string {
  if (text.indexOf('`') === -1) return text
  const out: string[] = []
  const open = new Map<number, number>() // run length -> start of the pending opener
  let last = 0
  let i = text.indexOf('`')
  while (i !== -1) {
    let j = i
    while (text.charCodeAt(j) === 96) j++
    const len = j - i
    const start = open.get(len)
    if (start !== undefined && start >= last) {
      out.push(text.slice(last, start))
      last = j
      for (const [l, at] of open) if (at >= start) open.delete(l)
    } else {
      open.set(len, i)
    }
    i = text.indexOf('`', j)
  }
  out.push(text.slice(last))
  return out.join('')
}

/**
 * Deepest blockquote/list nesting on any line: leading `>` markers, list markers, and indentation (also after a
 * quote marker, tabs counted as 4). Linear.
 */
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
    while (i < end) {
      const c = source.charCodeAt(i)
      if (c === 32 || c === 9) {
        if (markers === 0) indent += c === 9 ? 4 : 1
        i++
      } else if (c === 62) {
        quotes++
        i++
      } else if ((c === 45 || c === 42 || c === 43) && (source.charCodeAt(i + 1) === 32 || source.charCodeAt(i + 1) === 9)) {
        markers++
        i += 2
      } else if (c >= 48 && c <= 57) {
        let j = i
        while (j < end && j - i < 10 && source.charCodeAt(j) >= 48 && source.charCodeAt(j) <= 57) j++
        const d = source.charCodeAt(j)
        if ((d === 46 || d === 41) && (source.charCodeAt(j + 1) === 32 || source.charCodeAt(j + 1) === 9)) {
          markers++
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

/** Cells (columns x body rows) of every GFM table, summed, also inside blockquotes. Linear scan over the lines. */
function tableCells(source: string): number {
  const lines = source.split('\n')
  const bare = (line: string) => line.replace(/^[\s>]+/, '')
  let cells = 0
  for (let i = 1; i < lines.length; i++) {
    const line = bare(lines[i])
    if (line.indexOf('-') === -1 || line.indexOf('|') === -1 || !/^[\s|:-]+$/.test(line)) continue
    let pipes = 0
    for (let k = 0; k < line.length; k++) if (line.charCodeAt(k) === 124) pipes++
    let rows = 0
    for (let j = i + 1; j < lines.length && bare(lines[j]).trim() !== ''; j++) rows++
    cells += (pipes + 1) * Math.max(rows, 1)
    if (cells > README_MAX_TABLE_CELLS) return cells
  }
  return cells
}

/**
 * Deepest run of unmatched emphasis openers (`*`/`_` that can open but not close) inside one paragraph. Linear.
 * Word-separated emphasis nested thousands deep is cheap to write and slow or stack-hungry everywhere downstream.
 */
function maxEmphasisDepth(text: string, limit: number): number {
  let depth = 0
  let max = 0
  const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c)
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '\n') {
      if (text[i - 1] === '\n') depth = 0 // a blank line ends the paragraph
      continue
    }
    if (c !== '*' && c !== '_') continue
    let j = i
    while (text[j + 1] === c) j++
    const prev = text[i - 1]
    const next = text[j + 1]
    const canOpen = !isSpace(next) && (c === '*' || isSpace(prev) || /[^\p{L}\p{N}]/u.test(prev ?? ' '))
    const canClose = !isSpace(prev) && (c === '*' || isSpace(next) || /[^\p{L}\p{N}]/u.test(next ?? ' '))
    if (canOpen && !canClose) {
      depth++
      if (depth > max) max = depth
      if (max > limit) return max
    } else if (canClose && !canOpen) depth = Math.max(0, depth - 1)
    i = j
  }
  return max
}

function delimiterDensity(source: string): number {
  if (!source.length) return 0
  let n = 0
  for (let i = 0; i < source.length; i++) if (DELIMITERS.has(source[i])) n++
  return n / source.length
}

/** True when the source nests deeply enough to make the Markdown/HTML parsers slow or recursive. */
export function isPathologicallyNested(source: string, limit = README_MAX_NESTING): boolean {
  return maxBlockNesting(source) > limit || maxHtmlNesting(withoutCode(source), limit) > limit
}

/** Why a README is rendered as plain text without even trying to parse it, or null when it may be parsed. */
export function readmeRenderBlocker(source: string): 'nesting' | 'table' | 'delimiters' | 'emphasis' | null {
  if (maxBlockNesting(source) > README_MAX_NESTING) return 'nesting'
  const text = withoutCode(source)
  if (maxHtmlNesting(text, README_MAX_NESTING) > README_MAX_NESTING) return 'nesting'
  if (tableCells(source) > README_MAX_TABLE_CELLS) return 'table'
  if (delimiterDensity(source) > README_MAX_DELIMITER_DENSITY) return 'delimiters'
  if (maxEmphasisDepth(text, README_MAX_EMPHASIS_DEPTH) > README_MAX_EMPHASIS_DEPTH) return 'emphasis'
  return null
}

export type ReadmeRenderResult = { html: string | null; /** Why `html` is null: `cap:<which>`, `size` or `error`. */ reason?: string }

/**
 * The sanitized, URL-rewritten HTML of a README plus, when it stays plain text, why. Never throws. The output is safe
 * to embed: `rehype-sanitize` (GitHub's schema) runs before the tree is serialised.
 */
export function renderReadmeDetailed(source: string, repo: RepoRef): ReadmeRenderResult {
  try {
    const text = source.length > README_MARKDOWN_MAX ? source.slice(0, README_MARKDOWN_MAX) : source
    const blocker = readmeRenderBlocker(text)
    if (blocker) return { html: null, reason: `cap:${blocker}` }
    const processor = unified()
      .use(remarkParse)
      .use(remarkGfm)
      // Empty prefix: the sanitizer adds user-content- to every id once; resolveAnchors points links at those ids.
      .use(remarkRehype, { allowDangerousHtml: true, clobberPrefix: '' })
      .use(rehypeRaw)
      .use(rehypeSanitize, readmeSanitizeSchema)
      .use(rehypeReadme, repo)
    const tree = processor.runSync(processor.parse(text)) as Root
    // Authoritative structural check on the final tree (the pre-parse scans are only early exits and can be fooled).
    if (maxTreeDepth(tree, README_MAX_TREE_DEPTH) > README_MAX_TREE_DEPTH) return { html: null, reason: 'cap:depth' }
    const html = toHtml(tree)
    return html.length > README_HTML_MAX_CHARS ? { html: null, reason: 'size' } : { html }
  } catch {
    return { html: null, reason: 'error' }
  }
}

/** The HTML of renderReadmeDetailed, or null (plain text). */
export function renderReadmeHtml(source: string, repo: RepoRef): string | null {
  return renderReadmeDetailed(source, repo).html
}
