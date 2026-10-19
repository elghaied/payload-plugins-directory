import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginDetail } from '@/lib/directory/types'
import { toCategoryNodes } from '@/taxonomy/tree'

const state = vi.hoisted(() => ({ detail: null as unknown }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children),
}))
vi.mock('@/lib/directory/queries', () => ({ getPluginDetail: async () => state.detail }))
vi.mock('@/lib/directory/taxonomy', () => ({
  getCategoryNodes: async () =>
    toCategoryNodes([
      { id: 1, slug: 'storage-media', title: 'Storage & Media', _h_slugPath: 'storage-media' },
      { id: 2, slug: 'cloud-storage', title: 'Cloud storage', parent: 1, _h_slugPath: 'storage-media/cloud-storage' },
    ]),
}))

import PluginDetailPage from '@/app/(site)/plugins/[slug]/page'
import { README_RENDER_MAX } from '@/lib/directory/readme'

const base: PluginDetail = {
  slug: 's3', name: 'payload s3', description: 'AI tagline', owner: 'acme', ownerAvatar: '', url: 'https://github.com/acme/s3',
  repositoryUrl: 'https://github.com/acme/s3', stars: 1, forks: 0, openIssues: 0, lastUpdate: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z', topics: [], isOfficial: false, payloadMajors: ['3'], license: null, isArchived: false,
  authorDescription: 'Author words', tagList: [], payloadVersionRange: null,
}
const render = async (detail: Partial<PluginDetail>) => {
  state.detail = { ...base, ...detail }
  return renderToStaticMarkup((await PluginDetailPage({ params: Promise.resolve({ slug: 's3' }) })) as never)
}

beforeEach(() => {
  state.detail = null
})

describe('plugin detail page', () => {
  it('caps a huge README at render time and links to the full one on GitHub', async () => {
    const huge = 'x'.repeat(README_RENDER_MAX + 5_000)
    const html = await render({ readme: 'short preview', readmeFull: huge })
    expect(README_RENDER_MAX).toBe(100_000)
    expect(html).not.toContain(huge)
    expect(html).toContain('x'.repeat(1_000))
    expect(html).toMatch(/<a[^>]*href="https:\/\/github.com\/acme\/s3"[^>]*>View full README on GitHub/)
    expect(await render({ readme: 'short', readmeFull: 'short and complete' })).not.toContain('View full README on GitHub')
  })

  it('shows the category badge only when the category resolves to a trail', async () => {
    const ok = await render({ category: { slug: 'cloud-storage', title: 'Cloud storage', path: 'storage-media/cloud-storage' } })
    expect(ok).toContain('href="/categories/storage-media/cloud-storage"')
    const orphan = await render({ category: { slug: 'gone', title: 'Gone category', path: 'gone' } })
    expect(orphan.replace(/<script[\s\S]*?<\/script>/, '')).not.toContain('Gone category') // JSON-LD aside
  })

  it('hides "From the author" when there is no author text', async () => {
    expect(await render({})).toContain('From the author')
    expect(await render({ authorDescription: '' })).not.toContain('From the author')
  })

  it('shows the maintainer tagline in the header', async () => {
    expect(await render({ customTagline: 'Handwritten tagline' })).toContain('Handwritten tagline')
  })
})
