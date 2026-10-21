import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const searchSite = vi.hoisted(() => vi.fn())
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))
vi.mock('@/lib/search/site', () => ({ searchSite }))
vi.mock('@/components/PluginListCard', () => ({ PluginListCard: ({ plugin }: { plugin: { slug: string } }) => createElement('div', null, plugin.slug) }))
vi.mock('@/components/templates/TemplateMiniCard', () => ({ TemplateMiniCard: ({ template }: { template: { slug: string } }) => createElement('div', null, `tpl:${template.slug}`) }))

import SearchPage from '@/app/(site)/search/page'

const ok = (plugins: { slug: string }[], templates: { slug: string }[]) => ({
  status: 'ok', query: 'shop', tooShort: false, truncated: false, hasMore: false, categories: [], tags: [], plugins, templates,
})
const render = async () => renderToStaticMarkup((await SearchPage({ searchParams: Promise.resolve({ q: 'shop' }) })) as never)

describe('search page', () => {
  it('gives the "try fewer words" advice only when nothing matched at all', async () => {
    searchSite.mockResolvedValue(ok([], []))
    expect(await render()).toContain('Try fewer or different words')
    searchSite.mockResolvedValue(ok([], [{ slug: 'website' }]))
    const html = await render()
    expect(html).toContain('tpl:website')
    expect(html).not.toContain('Try fewer or different words')
    expect(html).toContain('No plugins match')
  })
})
