import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateSummary } from '@/lib/templates/types'

const nav = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({
  useSearchParams: () => nav.params,
  useRouter: () => ({ replace: () => {}, push: () => {} }),
  usePathname: () => '/',
}))
vi.mock('@/components/PluginDirectory', () => ({
  PluginDirectory: () => React.createElement('div', { 'data-testid': 'plugin-directory' }),
}))

import { DirectoryHome } from '@/components/templates/DirectoryHome'
import { TemplateCard } from '@/components/templates/TemplateCard'

const tpl = (over: Partial<TemplateSummary> = {}): TemplateSummary => ({
  slug: 'website',
  name: 'Website',
  tagline: 'A full website template',
  owner: 'payloadcms',
  ownerAvatar: '',
  repositoryUrl: 'https://github.com/payloadcms/payload',
  url: '/templates/website',
  isOfficial: false,
  stars: 42,
  payloadMajors: ['3'],
  stack: 'nextjs',
  lastUpdate: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  image: { src: 'https://raw.githubusercontent.com/x/y/main/a.png', local: false },
  ...over,
})

const home = () =>
  renderToStaticMarkup(
    React.createElement(DirectoryHome, {
      plugins: [],
      metadata: { lastUpdated: '2026-10-01T00:00:00.000Z', totalCount: 0 },
      categories: [],
      tags: [],
      templates: [tpl(), tpl({ slug: 'blank', name: 'Blank', isOfficial: true, stars: null, demoUrl: 'https://demo.example.com' })],
      templateCategories: [],
    } as never),
  )
const card = (t: TemplateSummary) => renderToStaticMarkup(React.createElement(TemplateCard, { template: t }))

beforeEach(() => {
  nav.params = new URLSearchParams()
})

describe('DirectoryHome', () => {
  it('defaults to the plugin directory', () => {
    const html = home()
    expect(html).toContain('data-testid="plugin-directory"')
    expect(html).not.toContain('Live demo')
  })
  it('shows templates for type=templates and links the switch to / and /?type=templates', () => {
    nav.params = new URLSearchParams('type=templates')
    const html = home()
    expect(html).not.toContain('data-testid="plugin-directory"')
    expect(html).toContain('Website screenshot')
    expect(html).toContain('Blank screenshot')
    expect(html).toContain('href="/"')
    expect(html).toContain('href="/?type=templates"')
    expect(html).toContain('Plugins (0)')
    expect(html).toContain('Templates (2)')
  })
  it('treats an unknown type as plugins', () => {
    nav.params = new URLSearchParams('type=all')
    expect(home()).toContain('data-testid="plugin-directory"')
  })
  it('filters by URL params and shows the empty state with a clear link', () => {
    nav.params = new URLSearchParams('type=templates&q=zzzz')
    const html = home()
    expect(html).toContain('No templates match.')
    expect(html).toContain('Clear filters')
  })
})

describe('TemplateCard', () => {
  it('has no Live demo link without demoUrl, and always a Details link', () => {
    const html = card(tpl())
    expect(html).not.toContain('Live demo')
    expect(html).toContain('href="/templates/website"')
  })
  it('renders a safe external Live demo link', () => {
    const html = card(tpl({ demoUrl: 'https://demo.example.com' }))
    expect(html).toContain('Live demo')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"')
  })
  it('sets no-referrer on remote images only', () => {
    // React's static markup spells the attribute referrerPolicy (HTML attribute names are case-insensitive).
    expect(card(tpl())).toContain('referrerPolicy="no-referrer"')
    expect(card(tpl({ image: { src: '/api/media/file/a.webp', local: true } })).toLowerCase()).not.toContain('referrerpolicy')
  })
  it('renders the local branded panel without any image request for a panel image', () => {
    const html = card(tpl({ isOfficial: true, stars: null, stack: 'tanstack-start', image: { src: '', local: true, panel: true } }))
    expect(html).toContain('data-template-panel')
    expect(html).toContain('TanStack Start')
    expect(html).not.toContain('<img')
  })
  it('uses lazy decoding and the image box', () => {
    const html = card(tpl())
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('alt="Website screenshot"')
  })
  it('hides stars for official templates and shows the badge', () => {
    const off = card(tpl({ isOfficial: true, stars: null }))
    expect(off).toContain('Official')
    expect(off).not.toContain('★')
    expect(card(tpl())).toContain('★')
  })
})

describe('TemplateCard buttons', () => {
  it('makes Live demo primary and Details outline when both exist', () => {
    const html = card(tpl({ demoUrl: 'https://demo.example.com' }))
    expect(html).toMatch(/bg-primary[^"]*"[^>]*>Live demo/)
    expect(html).toMatch(/border px-3[^"]*"[^>]*href="\/templates\/website">Details|href="\/templates\/website">Details/)
    expect(html).not.toMatch(/bg-primary[^"]*" href="\/templates\/website"/)
  })
})
