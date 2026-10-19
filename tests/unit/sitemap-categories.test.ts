import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/directory/queries', () => ({
  getPluginSummaries: async () => [{ slug: 'a', lastUpdate: '2026-10-01T00:00:00.000Z' }],
}))
vi.mock('@/lib/directory/taxonomy', () => ({
  getCategoryIndex: async () => [
    { slug: 'storage-media', title: 'Storage & Media', path: 'storage-media', depth: 0, count: 2 },
    { slug: 'cloud-storage', title: 'Cloud storage', path: 'storage-media/cloud-storage', depth: 1, count: 2 },
    { slug: 'empty', title: 'Empty', path: 'empty', depth: 0, count: 0 },
  ],
}))

import sitemap from '@/app/sitemap'

beforeEach(() => vi.stubEnv('SERVER_URL', 'https://payloaddirectory.dev'))
afterEach(() => vi.unstubAllEnvs())

describe('sitemap', () => {
  it('lists the categories index and every non-empty category page', async () => {
    const urls = (await sitemap()).map((e) => e.url)
    expect(urls).toContain('https://payloaddirectory.dev/categories')
    expect(urls).toContain('https://payloaddirectory.dev/categories/storage-media')
    expect(urls).toContain('https://payloaddirectory.dev/categories/storage-media/cloud-storage')
    expect(urls).not.toContain('https://payloaddirectory.dev/categories/empty')
    expect(urls).toContain('https://payloaddirectory.dev/plugins/a')
  })
})
