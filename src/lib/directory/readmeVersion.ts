import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const FILES = ['markdown.ts', 'readmeHtml.ts', 'readmeWorker.mjs']
const DEPENDENCIES = ['unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'rehype-raw', 'rehype-sanitize', 'hast-util-to-html']

let cached: string | undefined

/**
 * Identifies the render pipeline: a hash of its source (allow-list, sanitizer schema, rewriting, caps) and the pinned
 * versions of the parsing libraries. Stored beside each rendered README; rows whose stored version differs are
 * re-rendered by `payload render-readmes`. Worker side only (reads the sources from disk).
 */
export function readmeRenderVersion(): string {
  if (cached) return cached
  const hash = createHash('sha256')
  for (const f of FILES) hash.update(readFileSync(join(/* turbopackIgnore: true */ process.cwd(), 'src/lib/directory', f)))
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as { dependencies?: Record<string, string> }
  hash.update(JSON.stringify(DEPENDENCIES.map((d) => [d, pkg.dependencies?.[d] ?? null])))
  cached = hash.digest('hex').slice(0, 16)
  return cached
}
