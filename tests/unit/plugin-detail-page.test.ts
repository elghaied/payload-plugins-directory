import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginDetail } from '@/lib/directory/types'
import { toCategoryNodes } from '@/taxonomy/tree'

const state = vi.hoisted(() => ({ detail: null as unknown, trends: null as unknown }))
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children),
}))
vi.mock('@/lib/directory/queries', () => ({ getPluginDetail: async () => state.detail, getSimilarPlugins: async () => [] }))
vi.mock('@/lib/trends/queries', () => ({ getPluginTrends: async () => state.trends }))
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
  state.trends = null
})

describe('plugin detail page', () => {
  it('caps a huge README at render time', async () => {
    const huge = 'x'.repeat(README_RENDER_MAX + 5_000)
    const html = await render({ readme: 'short preview', readmeFull: huge })
    expect(README_RENDER_MAX).toBe(100_000)
    expect(html).not.toContain(huge)
    expect(html).toContain('x'.repeat(1_000))
  })

  it('shows the truncation notice with the repository URL only when sync truncated the README', async () => {
    const html = await render({ readme: 'short preview', readmeFull: 'x'.repeat(2_000), readmeTruncated: true })
    expect(html).toMatch(/<a[^>]*href="https:\/\/github.com\/acme\/s3"[^>]*>README truncated — read the full version on GitHub/)
    const whole = await render({ readme: 'short', readmeFull: 'short and complete' })
    expect(whole).not.toContain('README truncated')
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

  describe('trends section', () => {
    const empty = { stars: [], downloads: [], sharedRepository: null }

    it('is absent when trends are unavailable', async () => {
      expect(await render({ packageName: 'payload-s3' })).not.toContain('Trends (last')
    })

    const npm = { latestVersion: '1.0.0', weeklyDownloads: 5, dependencyCount: 0 } as never

    it('hides the downloads chart for a package without npm data', async () => {
      state.trends = empty
      const html = await render({ packageName: 'unpublished-pkg', npm: undefined })
      expect(html).toContain('GitHub stars')
      expect(html).not.toContain('npm weekly downloads')
      expect(html).not.toContain('sm:grid-cols-2')
    })

    it('shows the insufficient-data state for both charts when npm data exists', async () => {
      state.trends = empty
      const html = await render({ packageName: 'payload-s3', npm })
      expect(html).toContain('Trends (last 90 days)')
      expect(html).toContain('GitHub stars')
      expect(html).toContain('npm weekly downloads')
      expect(html).toContain('Daily snapshots have not started yet.')
      expect(html).not.toContain('Data as of')
    })

    it('shows only the stars chart without a package name and labels shared repositories', async () => {
      state.trends = { ...empty, sharedRepository: { fullName: 'acme/mono', pluginCount: 3 } }
      const html = await render({ packageName: undefined })
      expect(html).toContain('Repository stars')
      expect(html).toContain('Shared by 3 plugins in acme/mono.')
      expect(html).not.toContain('npm weekly downloads')
    })

    it('notes stale data only when the last snapshot is more than 2 days old', async () => {
      const day = (back: number) => new Date(Date.now() - back * 86_400_000).toISOString().slice(0, 10)
      state.trends = { ...empty, stars: [{ date: day(5), value: 10 }] }
      expect(await render({})).toMatch(/Data as of [A-Z][a-z]{2} \d{1,2}, \d{4}/)
      state.trends = { ...empty, stars: [{ date: day(1), value: 10 }] }
      expect(await render({})).not.toContain('Data as of')
    })
  })
})
