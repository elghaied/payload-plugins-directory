import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const getCategoryPage = vi.hoisted(() => vi.fn())
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))
vi.mock('@/lib/directory/taxonomy', () => ({ getCategoryPage }))
vi.mock('@/components/PluginListCard', () => ({ PluginListCard: ({ plugin }: { plugin: { slug: string } }) => createElement('div', null, plugin.slug) }))

import CategoryPage, { generateMetadata } from '@/app/(site)/categories/[...path]/page'

const node = { slug: 'cloud-storage', title: 'Cloud storage', path: 'storage-media/cloud-storage', depth: 1, intro: null as string | null }
const page = (plugins: { slug: string; name: string }[], intro: string | null = null) => {
  getCategoryPage.mockResolvedValue({ node: { ...node, intro }, trail: [{ ...node, intro }], children: [], plugins })
}
const params = (...path: string[]) => ({ params: Promise.resolve({ path }) })

describe('category page', () => {
  it('uses the right plural', async () => {
    page([{ slug: 'a', name: 'A' }])
    expect(renderToStaticMarkup((await CategoryPage(params('storage-media', 'cloud-storage'))) as never)).toContain('1 plugin, ranked')
    page([{ slug: 'a', name: 'A' }, { slug: 'b', name: 'B' }])
    expect(renderToStaticMarkup((await CategoryPage(params('storage-media', 'cloud-storage'))) as never)).toContain('2 plugins, ranked')
  })

  it('names its own URL as canonical, not the homepage', async () => {
    page([])
    const meta = await generateMetadata(params('storage-media', 'cloud-storage'))
    expect(meta.alternates?.canonical).toBe('/categories/storage-media/cloud-storage')
  })

  it('truncates the meta description at a word boundary', async () => {
    page([], `${'word '.repeat(40)}end`)
    const { description } = await generateMetadata(params('storage-media', 'cloud-storage'))
    expect(typeof description).toBe('string')
    expect((description as string).length).toBeLessThanOrEqual(160)
    expect(description as string).toMatch(/word…$/)
  })

  it('is a 404 for a segment holding a slash, also when encoded as %2F', async () => {
    page([])
    getCategoryPage.mockClear()
    await expect(CategoryPage(params('storage-media%2Fcloud-storage'))).rejects.toThrow()
    await expect(CategoryPage(params('storage-media/cloud-storage'))).rejects.toThrow()
    expect(getCategoryPage).not.toHaveBeenCalled()
  })
})
