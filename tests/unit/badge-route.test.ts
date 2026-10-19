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
