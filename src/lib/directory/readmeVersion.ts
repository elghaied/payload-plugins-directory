import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'

const FILES = ['markdown.ts', 'readmeHtml.ts', 'readmeLimits.ts', 'readmeWorker.mjs']
/** Direct dependencies whose resolved dependency closure (names and installed versions) is part of the version. */
const ROOTS = ['unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'rehype-raw', 'rehype-sanitize', 'hast-util-to-html']

let cached: string | undefined

type PackageJson = { name?: string; version?: string; dependencies?: Record<string, string> }

/**
 * `name@version` of every package reachable from the pipeline's direct dependencies, as installed (not as declared):
 * a lockfile-only upgrade of mdast-util-to-hast, micromark, parse5... changes the output and so the version.
 * pnpm lays a package's dependencies out as siblings of its real directory.
 */
function installedClosure(): string[] {
  const seen = new Map<string, string>() // real dir -> name@version
  const visit = (dir: string, depth: number) => {
    let real: string
    try {
      real = realpathSync(dir)
    } catch {
      return
    }
    if (seen.has(real) || depth > 6) return
    const file = join(real, 'package.json')
    if (!existsSync(file)) return
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as PackageJson
    seen.set(real, `${pkg.name}@${pkg.version}`)
    const siblings = dirname(pkg.name?.startsWith('@') ? dirname(real) : real)
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(join(siblings, dep), depth + 1)
  }
  for (const root of ROOTS) visit(join(/* turbopackIgnore: true */ process.cwd(), 'node_modules', root), 0)
  return [...seen.values()].sort()
}

/**
 * Identifies the render pipeline: a hash of its source (allow-list, sanitizer schema, rewriting, caps, limits) and the
 * installed versions of every package it depends on. Stored (with the README hash) beside each rendered README; rows
 * whose stored stamp differs are re-rendered by the `render-readmes` job. Worker side only (reads files from disk).
 */
export function readmeRenderVersion(): string {
  if (cached) return cached
  const hash = createHash('sha256')
  for (const f of FILES) hash.update(readFileSync(join(/* turbopackIgnore: true */ process.cwd(), 'src/lib/directory', f)))
  hash.update(JSON.stringify(installedClosure()))
  cached = hash.digest('hex').slice(0, 16)
  return cached
}

/** Tests: the packages the version covers. */
export const versionedPackages = installedClosure
