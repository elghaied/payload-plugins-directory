import { parseArgs } from 'util'
import { pathToFileURL } from 'url'

export function extractSitemapPaths(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).sort()
}

export function diffPaths(a: string[], b: string[]) {
  const sa = new Set(a)
  const sb = new Set(b)
  return { onlyInA: a.filter((p) => !sb.has(p)), onlyInB: b.filter((p) => !sa.has(p)) }
}

const USAGE = 'Usage: pnpm parity --a <baseUrl> --b <baseUrl>\n  e.g. pnpm parity --a https://payloaddirectory.dev --b https://next.payloaddirectory.dev'

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { a: { type: 'string' }, b: { type: 'string' } } })
  if (!values.a || !values.b) {
    console.error(USAGE)
    process.exitCode = 2
    return
  }
  const a = values.a
  const b = values.b
  const [pa, pb] = await Promise.all(
    [a, b].map(async (base) => extractSitemapPaths(await (await fetch(`${base}/sitemap.xml`)).text())),
  )
  const diff = diffPaths(pa, pb)
  console.log(`A: ${pa.length} paths, B: ${pb.length} paths`)
  if (diff.onlyInA.length) console.log('Missing on B:', diff.onlyInA)
  if (diff.onlyInB.length) console.log('Extra on B:', diff.onlyInB)

  const failures: string[] = []
  for (let i = 0; i < pa.length; i += 10) {
    await Promise.all(
      pa.slice(i, i + 10).map(async (p) => {
        const res = await fetch(`${b}${p}`, { redirect: 'manual' })
        if (res.status !== 200) failures.push(`${res.status} ${p}`)
      }),
    )
  }
  for (const f of ['/feed.xml', '/robots.txt', '/api/health']) {
    const res = await fetch(`${b}${f}`)
    if (res.status !== 200) failures.push(`${res.status} ${f}`)
  }
  if (failures.length) console.log('Non-200 on B:', failures)
  process.exitCode = diff.onlyInA.length || failures.length ? 1 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
