import { describe, expect, it } from 'vitest'
import { diffPaths, extractSitemapPaths, runParity } from '../../scripts/parity'

describe('extractSitemapPaths', () => {
  it('returns sorted paths regardless of host', () => {
    const xml = `<urlset><url><loc>https://payloaddirectory.dev/plugins/b</loc></url><url><loc>https://payloaddirectory.dev/</loc></url></urlset>`
    expect(extractSitemapPaths(xml)).toEqual(['/', '/plugins/b'])
  })
})

describe('diffPaths', () => {
  it('reports both sides', () => {
    expect(diffPaths(['/', '/a', '/b'], ['/', '/b', '/c'])).toEqual({ onlyInA: ['/a'], onlyInB: ['/c'] })
  })
})

const sitemap = (...paths: string[]) =>
  `<urlset>${paths.map((p) => `<url><loc>https://x.dev${p}</loc></url>`).join('')}</urlset>`

/** Fake fetch: routes by full URL; a value of 'THROW' rejects, anything else is a response body/status. */
function fakeFetch(routes: Record<string, { status?: number; body?: string } | 'THROW'>) {
  const calls: string[] = []
  const impl = async (input: string | URL): Promise<Response> => {
    const url = String(input)
    calls.push(url)
    const route = routes[url]
    if (route === 'THROW') throw new Error(`boom ${url}`)
    if (!route) return new Response('not found', { status: 404 })
    return new Response(route.body ?? '', { status: route.status ?? 200 })
  }
  return { impl, calls }
}

const okRoutes = (base: string, paths: string[]) => {
  const r: Record<string, { status?: number; body?: string }> = {
    [`${base}/sitemap.xml`]: { body: sitemap(...paths) },
    [`${base}/feed.xml`]: {},
    [`${base}/robots.txt`]: {},
    [`${base}/api/health`]: {},
  }
  for (const p of paths) r[`${base}${p}`] = {}
  return r
}

describe('runParity (fake fetch)', () => {
  it('fails closed when A sitemap returns 500', async () => {
    const { impl } = fakeFetch({ 'https://a.dev/sitemap.xml': { status: 500 } })
    const res = await runParity('https://a.dev', 'https://b.dev', impl)
    expect(res.exitCode).toBe(1)
    expect(res.failures).toContain('500 /sitemap.xml (A)')
  })

  it('fails closed when A sitemap yields zero paths', async () => {
    const { impl } = fakeFetch({ 'https://a.dev/sitemap.xml': { body: '<urlset></urlset>' } })
    const res = await runParity('https://a.dev', 'https://b.dev', impl)
    expect(res.exitCode).toBe(1)
    expect(res.failures).toContain('EMPTY /sitemap.xml (A)')
  })

  it('records a rejecting path as ERR, keeps checking other paths, and exits 1', async () => {
    const routes: Record<string, { status?: number; body?: string } | 'THROW'> = {
      ...okRoutes('https://a.dev', ['/', '/p/1', '/p/2']),
      ...okRoutes('https://b.dev', ['/', '/p/1', '/p/2']),
    }
    routes['https://b.dev/p/1'] = 'THROW'
    const { impl, calls } = fakeFetch(routes)
    const res = await runParity('https://a.dev', 'https://b.dev', impl)
    expect(res.exitCode).toBe(1)
    expect(res.failures.some((f) => f.startsWith('ERR /p/1 ') && f.includes('boom'))).toBe(true)
    expect(calls).toContain('https://b.dev/p/2')
    expect(calls).toContain('https://b.dev/feed.xml')
  })

  it('exits 0 when all 200 and sitemaps are identical', async () => {
    const routes = {
      ...okRoutes('https://a.dev', ['/', '/p/1']),
      ...okRoutes('https://b.dev', ['/', '/p/1']),
    }
    const res = await runParity('https://a.dev', 'https://b.dev', fakeFetch(routes).impl)
    expect(res.exitCode).toBe(0)
    expect(res.failures).toEqual([])
  })

  it('strips trailing slashes from base URLs', async () => {
    const routes = {
      ...okRoutes('https://a.dev', ['/', '/p/1']),
      ...okRoutes('https://b.dev', ['/', '/p/1']),
    }
    const { impl, calls } = fakeFetch(routes)
    const res = await runParity('https://a.dev/', 'https://b.dev///', impl)
    expect(res.exitCode).toBe(0)
    expect(calls).toContain('https://a.dev/sitemap.xml')
    expect(calls).toContain('https://b.dev/p/1')
    expect(calls.some((c) => c.includes('//sitemap') || c.includes('.dev//'))).toBe(false)
  })
})
