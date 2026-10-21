import { afterEach, describe, expect, it, vi } from 'vitest'

const getPluginDetail = vi.fn()
vi.mock('@/lib/directory/queries', () => ({ getPluginDetail: (...a: unknown[]) => getPluginDetail(...a) }))

import { GET } from '@/app/badge/[file]/route'

const call = (file: string) => GET(new Request('http://x/badge/' + file), { params: Promise.resolve({ file }) })

afterEach(() => {
  vi.unstubAllEnvs()
  getPluginDetail.mockReset()
})

describe('GET /badge/[file]', () => {
  it('uses SERVER_URL and never the production host', async () => {
    vi.stubEnv('SERVER_URL', 'https://staging.example.test')
    getPluginDetail.mockResolvedValue({ slug: 'seo', healthScore: 80 })
    const body = await (await call('seo.svg')).text()
    expect(body).toContain('href="https://staging.example.test/plugins/seo"')
    expect(body).not.toContain('payloaddirectory.dev')
  })
  it('renders unlinked with no configured URL', async () => {
    vi.stubEnv('SERVER_URL', '')
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    getPluginDetail.mockResolvedValue({ slug: 'seo', healthScore: 80 })
    const body = await (await call('seo.svg')).text()
    expect(body).not.toContain('<a ')
    expect(body).not.toContain('payloaddirectory.dev')
  })
  it('404s for unlisted/trashed (null) and invalid files without querying invalid ones', async () => {
    getPluginDetail.mockResolvedValue(null)
    expect((await call('gone.svg')).status).toBe(404)
    getPluginDetail.mockClear()
    expect((await call('../x.svg')).status).toBe(404)
    expect((await call('x.png')).status).toBe(404)
    expect(getPluginDetail).not.toHaveBeenCalled()
  })
})

describe('GET /badge/templates/[file]', async () => {
  const getTemplateDetail = vi.fn()
  vi.doMock('@/lib/templates/queries', () => ({ getTemplateDetail: (...a: unknown[]) => getTemplateDetail(...a) }))
  const { GET: TGET } = await import('@/app/badge/templates/[file]/route')
  const tcall = (file: string) => TGET(new Request('http://x/badge/templates/' + file), { params: Promise.resolve({ file }) })

  it('renders "template" linking to the template page', async () => {
    vi.stubEnv('SERVER_URL', 'https://staging.example.test')
    getTemplateDetail.mockResolvedValue({ slug: 'website', isOfficial: false })
    const res = await tcall('website.svg')
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(body).toContain('Payload Directory')
    expect(body).toContain('>template<')
    expect(body).toContain('href="https://staging.example.test/templates/website"')
    expect(res.headers.get('Cache-Control')).toContain('s-maxage=3600')
  })
  it('says "official template" for official ones', async () => {
    getTemplateDetail.mockResolvedValue({ slug: 'website', isOfficial: true })
    expect(await (await tcall('website.svg')).text()).toContain('official template')
  })
  it('returns the not-found badge for unknown, hidden or trashed slugs and invalid files', async () => {
    getTemplateDetail.mockResolvedValue(null)
    const res = await tcall('gone.svg')
    expect(res.status).toBe(404)
    expect(await res.text()).toContain('not found')
    getTemplateDetail.mockClear()
    expect((await tcall('../x.svg')).status).toBe(404)
    expect(getTemplateDetail).not.toHaveBeenCalled()
  })
})
