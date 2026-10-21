import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/directory/queries', () => ({
  getPluginSummaries: async () => [{ slug: 'a', name: 'A', description: 'd', createdAt: '2026-10-01T00:00:00.000Z', lastUpdate: '2026-10-01T00:00:00.000Z' }],
  getDirectoryMeta: async () => ({ lastUpdated: '2026-10-01T00:00:00.000Z', totalCount: 1 }),
}))
vi.mock('@/lib/directory/taxonomy', () => ({ getCategoryIndex: async () => [] }))
vi.mock('@/lib/templates/queries', () => ({ getTemplateSummaries: async () => [], getTemplateCategoryIndex: async () => [] }))

import robots from '@/app/robots'
import sitemap from '@/app/sitemap'
import { GET as feed } from '@/app/feed.xml/route'

afterEach(() => vi.unstubAllEnvs())

describe('public URLs use SERVER_URL, never a hardcoded host', () => {
  it('sitemap', async () => {
    vi.stubEnv('SERVER_URL', 'https://staging.example.dev/')
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).toContain('https://staging.example.dev')
    expect(urls).toContain('https://staging.example.dev/plugins/a')
    expect(urls.join(' ')).not.toContain('payloaddirectory.dev')
  })
  it('robots points at the production sitemap from SERVER_URL', () => {
    vi.stubEnv('SERVER_URL', 'https://payloaddirectory.dev')
    expect(robots().sitemap).toBe('https://payloaddirectory.dev/sitemap.xml')
  })
  it('feed', async () => {
    vi.stubEnv('SERVER_URL', 'https://staging.example.dev')
    const xml = await (await feed()).text()
    expect(xml).toContain('<link>https://staging.example.dev/plugins/a</link>')
    expect(xml).toContain('<link>https://staging.example.dev</link>')
    expect(xml).toContain('href="https://staging.example.dev/feed.xml"')
    expect(xml).not.toContain('payloaddirectory.dev')
  })
})
