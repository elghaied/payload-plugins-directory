import { parseArgs } from 'util'
import { pathToFileURL } from 'url'

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface ParityResult {
  exitCode: number
  countA: number
  countB: number
  onlyInA: string[]
  onlyInB: string[]
  failures: string[]
}

const TIMEOUT_MS = 15_000
const BATCH = 10
const USAGE =
  'Usage: pnpm parity --a <baseUrl> --b <baseUrl>\n  e.g. pnpm parity --a https://payloaddirectory.dev --b https://next.payloaddirectory.dev'

export function extractSitemapPaths(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).sort()
}

export function diffPaths(a: string[], b: string[]) {
  const sa = new Set(a)
  const sb = new Set(b)
  return { onlyInA: a.filter((p) => !sb.has(p)), onlyInB: b.filter((p) => !sa.has(p)) }
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** Every request goes through here: timeout applied, rejections turned into ERR records. */
async function request(
  fetchImpl: FetchLike,
  url: string,
  path: string,
  failures: string[],
  init: RequestInit = {},
): Promise<Response | null> {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    return res
  } catch (e) {
    failures.push(`ERR ${path} ${errMessage(e)}`)
    return null
  }
}

async function sitemapPaths(
  fetchImpl: FetchLike,
  base: string,
  side: 'A' | 'B',
  failures: string[],
): Promise<string[]> {
  const path = '/sitemap.xml'
  const res = await request(fetchImpl, `${base}${path}`, `${path} (${side})`, failures)
  if (!res) return []
  if (res.status !== 200) {
    failures.push(`${res.status} ${path} (${side})`)
    return []
  }
  try {
    const paths = extractSitemapPaths(await res.text())
    if (paths.length === 0) failures.push(`EMPTY ${path} (${side})`)
    return paths
  } catch (e) {
    failures.push(`ERR ${path} (${side}) ${errMessage(e)}`)
    return []
  }
}

/**
 * Compares the sitemaps of two deployments and checks every path on B.
 * Never rejects: network and parse errors are recorded as failures so the
 * full report is always produced and the exit code fails closed.
 */
export async function runParity(a: string, b: string, fetchImpl: FetchLike = fetch): Promise<ParityResult> {
  const baseA = a.replace(/\/+$/, '')
  const baseB = b.replace(/\/+$/, '')
  const failures: string[] = []

  const [pa, pb] = await Promise.all([
    sitemapPaths(fetchImpl, baseA, 'A', failures),
    sitemapPaths(fetchImpl, baseB, 'B', failures),
  ])
  const diff = diffPaths(pa, pb)

  for (let i = 0; i < pa.length; i += BATCH) {
    await Promise.all(
      pa.slice(i, i + BATCH).map(async (p) => {
        const res = await request(fetchImpl, `${baseB}${p}`, p, failures, { redirect: 'manual' })
        if (res && res.status !== 200) failures.push(`${res.status} ${p}`)
      }),
    )
  }
  for (const f of ['/feed.xml', '/robots.txt', '/api/health']) {
    const res = await request(fetchImpl, `${baseB}${f}`, f, failures)
    if (res && res.status !== 200) failures.push(`${res.status} ${f}`)
  }

  failures.sort()
  const exitCode = failures.length > 0 || diff.onlyInA.length > 0 ? 1 : 0
  return { exitCode, countA: pa.length, countB: pb.length, ...diff, failures }
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { a: { type: 'string' }, b: { type: 'string' } } })
  if (!values.a || !values.b) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  const res = await runParity(values.a, values.b)
  console.log(`A: ${res.countA} paths, B: ${res.countB} paths`)
  if (res.onlyInA.length) console.log('Missing on B:', res.onlyInA)
  if (res.onlyInB.length) console.log('Extra on B:', res.onlyInB)
  if (res.failures.length) console.log('Failures on B:', res.failures)
  process.exitCode = res.exitCode
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
