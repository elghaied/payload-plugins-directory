import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/directory/queries', () => ({ getPluginSummaries: async () => [] }))
vi.mock('@/lib/directory/taxonomy', () => ({ getCategoryIndex: async () => [] }))
// getTemplateSummaries only returns listed templates, so a hidden one is simply absent.
vi.mock('@/lib/templates/queries', () => ({
  getTemplateSummaries: async () => [{ slug: 'website', lastUpdate: '2026-10-01T00:00:00.000Z' }],
  getTemplateCategoryIndex: async () => [
    { slug: 'landing-pages', title: 'Landing pages', path: 'landing-pages', depth: 0, count: 1 },
    { slug: 'empty', title: 'Empty', path: 'empty', depth: 0, count: 0 },
  ],
}))

import sitemap from '@/app/sitemap'

beforeEach(() => vi.stubEnv('SERVER_URL', 'https://payloaddirectory.dev'))
afterEach(() => vi.unstubAllEnvs())

describe('sitemap templates', () => {
  it('lists listed templates and non-empty template categories, not /templates or hidden ones', async () => {
    const entries = await sitemap()
    const urls = entries.map((e) => e.url)
    expect(urls).toContain('https://payloaddirectory.dev/templates/website')
    expect(urls).toContain('https://payloaddirectory.dev/templates/categories/landing-pages')
    expect(urls).not.toContain('https://payloaddirectory.dev/templates/categories/empty')
    expect(urls).not.toContain('https://payloaddirectory.dev/templates')
    expect(urls).not.toContain('https://payloaddirectory.dev/templates/hidden-one')
    const t = entries.find((e) => e.url.endsWith('/templates/website'))!
    expect(t.priority).toBe(0.7)
    expect(t.lastModified).toEqual(new Date('2026-10-01T00:00:00.000Z'))
    expect(entries.find((e) => e.url.endsWith('/templates/categories/landing-pages'))!.priority).toBe(0.6)
  })
})
