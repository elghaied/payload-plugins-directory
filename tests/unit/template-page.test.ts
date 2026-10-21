import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TemplateDetail, TemplateSummary } from '@/lib/templates/types'
import { allowedReadmeImageUrl } from '@/lib/directory/markdown'
import { toCategoryNodes } from '@/taxonomy/tree'

const state = vi.hoisted(() => ({ detail: null as unknown, similar: [] as unknown[], categoryPage: null as unknown }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => createElement('a', { href, ...rest }, children),
}))
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND')
  },
  useRouter: () => ({ replace: () => {}, push: () => {} }),
}))
vi.mock('next/cache', () => ({ unstable_cache: (fn: () => unknown) => fn }))
vi.mock('@/lib/templates/queries', () => ({
  getTemplateDetail: async () => state.detail,
  getSimilarTemplates: async () => state.similar,
  getTemplateCategoryPage: async () => state.categoryPage,
  getTemplateCategoryNodes: async () =>
    toCategoryNodes([
      { id: 1, slug: 'landing-pages', title: 'Landing pages', _h_slugPath: 'landing-pages' },
      { id: 2, slug: 'starters-boilerplates', title: 'Starters & boilerplates', _h_slugPath: 'starters-boilerplates' },
    ]),
}))

import TemplatePage, { generateMetadata } from '@/app/(site)/templates/[slug]/page'
import TemplateCategoryPage, { generateMetadata as categoryMetadata } from '@/app/(site)/templates/categories/[...path]/page'

const base: TemplateDetail = {
  slug: '990001-root', name: 'Shop starter', tagline: 'A tidy shop starter', owner: 'acme', ownerAvatar: 'https://avatars.githubusercontent.com/u/1',
  repositoryUrl: 'https://github.com/acme/shop', url: 'https://github.com/acme/shop', isOfficial: false, stars: 1234,
  payloadMajors: ['3'], stack: 'nextjs', lastUpdate: '2026-10-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  categoryPath: 'landing-pages', image: { src: 'https://opengraph.githubassets.com/1/acme/shop', local: false },
  authorDescription: 'Author words', license: 'MIT', path: null, fullName: 'acme/shop', screenshots: [],
  getStarted: { kind: 'link', value: 'https://github.com/acme/shop/generate' },
  category: { slug: 'landing-pages', title: 'Landing pages', path: 'landing-pages' },
  tagList: [{ slug: 'seo', title: 'SEO' }], payloadVersionRange: '^3.0.0',
  demoUrl: 'https://shop-demo.example.com/',
}
const official: Partial<TemplateDetail> = {
  slug: 'website', name: 'Website', isOfficial: true, stars: null, fullName: 'payloadcms/payload', path: 'templates/website',
  url: 'https://github.com/payloadcms/payload/tree/main/templates/website', owner: 'payloadcms',
  getStarted: { kind: 'command', value: 'npx create-payload-app -t website' }, demoUrl: undefined,
}
const params = { params: Promise.resolve({ slug: '990001-root' }) }
const render = async (detail: Partial<TemplateDetail> = {}) => {
  state.detail = { ...base, ...detail }
  return renderToStaticMarkup((await TemplatePage(params)) as never)
}
const summary = (slug: string): TemplateSummary => ({
  slug, name: `Similar ${slug}`, tagline: 't', owner: 'o', ownerAvatar: '', repositoryUrl: 'https://github.com/o/r', url: 'https://github.com/o/r',
  isOfficial: false, stars: 1, payloadMajors: ['3'], stack: 'nextjs', lastUpdate: '2026-10-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z',
  categoryPath: 'landing-pages', image: { src: 'https://raw.githubusercontent.com/o/r/main/a.png', local: false },
})

beforeEach(() => {
  state.detail = null
  state.similar = []
  state.categoryPage = null
  process.env.SERVER_URL = 'https://payloaddirectory.dev'
})

describe('template page', () => {
  it('is a 404 for an unknown slug', async () => {
    await expect(TemplatePage(params)).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(generateMetadata(params)).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('builds the title, tagline description and canonical URL', async () => {
    state.detail = base
    const meta = await generateMetadata(params)
    expect(meta.title).toBe('Shop starter — Payload template — Payload Directory')
    expect(meta.description).toBe('A tidy shop starter')
    expect(meta.alternates?.canonical).toBe('/templates/990001-root')
  })

  it('shows the official create-payload-app command and the Official badge', async () => {
    const html = await render(official)
    expect(html).toContain('npx create-payload-app -t website')
    expect(html).toContain('id="get-started"')
    expect(html).toContain('Official')
    // "Use this template" scrolls to the command for a command kind.
    expect(html).toMatch(/<a[^>]*href="#get-started"[^>]*>[^<]*Use this template/)
    expect(html).toMatch(/aria-label="Copy command"/)
  })

  it('links "Claim this template" to /claim/templates/<slug> on a community template only', async () => {
    expect(await render()).toMatch(/<a[^>]*href="\/claim\/templates\/990001-root"[^>]*>.*Claim this template/)
    expect(await render(official)).not.toContain('Claim this template')
  })

  it('links "Use this template" to GitHub /generate for a community template repo', async () => {
    const html = await render()
    expect(html).toMatch(/<a[^>]*href="https:\/\/github.com\/acme\/shop\/generate"[^>]*>[^<]*Use this template/)
  })

  it('opens the demo with nofollow ugc noopener noreferrer in a new tab', async () => {
    const html = await render()
    const demo = html.match(/<a[^>]*href="https:\/\/shop-demo.example.com\/"[^>]*>/)?.[0] ?? ''
    expect(demo).toContain('rel="nofollow ugc noopener noreferrer"')
    expect(demo).toContain('target="_blank"')
    expect(html).toContain('Live demo')
    expect(await render({ demoUrl: undefined })).not.toContain('Live demo')
  })

  it('renders no iframe and no third-party image outside the GitHub allow-list, even with a video and similar cards', async () => {
    state.similar = [summary('a'), summary('b'), summary('c')]
    const html = await render({
      video: { provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      readme: '# Hi', readmeHtml: '<p>Hi <img src="https://evil.example/beacon.png"></p>',
    })
    expect(html).not.toContain('<iframe')
    expect(html).not.toMatch(/youtube-nocookie|ytimg/)
    const srcs = [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, '&'))
    expect(srcs.length).toBeGreaterThan(0)
    for (const src of srcs) {
      const local = src.startsWith('/') || src.startsWith('https://payloaddirectory.dev/')
      expect(local || allowedReadmeImageUrl(src) !== null, src).toBe(true)
    }
    // Hotlinked images never send a referrer.
    for (const tag of html.match(/<img[^>]*>/g) ?? []) {
      if (/src="https:\/\/(?!payloaddirectory\.dev)/.test(tag)) expect(tag.toLowerCase()).toContain('referrerpolicy="no-referrer"')
    }
  })

  it('shows the gallery with labelled thumbnails, a video thumbnail and a full-screen button', async () => {
    const html = await render({
      screenshots: [1, 2, 3].map((i) => ({ full: `/api/media/file/s${i}-1600.webp`, card: `/api/media/file/s${i}-640.webp`, alt: `Shot ${i}` })),
      video: { provider: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    })
    expect(html).toContain('src="/api/media/file/s1-1600.webp"')
    expect(html).toContain('aria-label="Show screenshot 3 of 3"')
    expect(html).toContain('aria-label="Show video"')
    expect(html).toContain('View full screen')
    expect(html).toContain('<dialog')
    for (const tag of html.match(/<button[^>]*>/g) ?? []) expect(tag).toContain('aria-label=')
  })

  it('starts on the fallback image, not the video, when there are no screenshots', async () => {
    const html = await render({
      video: { provider: 'vimeo', embedUrl: 'https://player.vimeo.com/video/1?dnt=1', watchUrl: 'https://vimeo.com/1' },
    })
    expect(html).not.toContain('Play video (loads Vimeo)')
    expect(html).toMatch(/aria-label="Show preview image" aria-pressed="true"/)
    expect(html).toMatch(/aria-label="Show video" aria-pressed="false"/)
  })

  it('falls back to one allow-listed image without screenshots', async () => {
    const html = await render()
    expect(html).toMatch(/<img[^>]*src="https:\/\/opengraph.githubassets.com\/1\/acme\/shop"[^>]*referrerPolicy="no-referrer"/i)
    expect(html).not.toContain('View full screen')
  })

  it('shows the breadcrumbs, the AI overview with "Good for", the side panel and similar templates', async () => {
    state.similar = [summary('a'), summary('b'), summary('c')]
    const html = await render({ ai: { summary: 'AI summary', features: ['Blocks'], goodFor: ['Shops'], generated: true } })
    expect(html).toMatch(/<a href="\/\?type=templates"[^>]*>Templates<\/a>/)
    expect(html).toContain('href="/templates/categories/landing-pages"')
    expect(html).toContain('Good for')
    expect(html).not.toContain('Use cases')
    expect(html).toContain('Next.js')
    expect(html).toContain('MIT')
    expect(html).toContain('1,234')
    expect(html).toContain('View on GitHub')
    expect(html).toContain('More Landing pages templates')
    expect(html).toContain('Similar c')
    expect(html).not.toContain('Postgres')
    expect(html).not.toContain('Deploy')
  })

  it('emits SoftwareSourceCode JSON-LD with an escaped "<"', async () => {
    const html = await render({ name: 'Shop </script><script>alert(1)</script>' })
    const json = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1] ?? ''
    expect(json).not.toContain('</script')
    const ld = JSON.parse(json)
    expect(ld['@type']).toBe('SoftwareSourceCode')
    expect(ld.codeRepository).toBe('https://github.com/acme/shop')
    expect(ld.license).toBe('MIT')
    expect(ld.programmingLanguage).toBe('TypeScript')
    expect(ld.description).toBe('A tidy shop starter')
  })

  it('re-sanitizes the stored README HTML', async () => {
    const html = await render({ readme: '# Hi', readmeHtml: '<p>ok</p><script>alert(1)</script>' })
    expect(html).toContain('<div class="readme-prose"><p>ok</p>')
    expect(html).not.toContain('alert(1)')
  })
})

describe('template category page', () => {
  const node = { id: 1, slug: 'landing-pages', title: 'Landing pages', path: 'landing-pages', depth: 0, intro: 'Pages that sell.' as string | null }
  const cat = (...path: string[]) => ({ params: Promise.resolve({ path }) })

  it('lists the title, intro, child categories with counts and template cards', async () => {
    state.categoryPage = { node, trail: [node], children: [{ ...node, slug: 'child', title: 'Child', path: 'landing-pages/child', count: 2 }], templates: [summary('a')] }
    const html = renderToStaticMarkup((await TemplateCategoryPage(cat('landing-pages'))) as never)
    expect(html).toContain('<h1')
    expect(html).toContain('Landing pages')
    expect(html).toContain('Pages that sell.')
    expect(html).toContain('href="/templates/categories/landing-pages/child"')
    expect(html).toContain('(2)')
    expect(html).toContain('Similar a')
    expect(html).toContain('1 template')
  })

  it('is a 404 for an unknown path and for a slash inside a segment', async () => {
    await expect(TemplateCategoryPage(cat('nope'))).rejects.toThrow('NEXT_NOT_FOUND')
    state.categoryPage = { node, trail: [node], children: [], templates: [] }
    await expect(TemplateCategoryPage(cat('landing-pages%2Fx'))).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('sets the canonical URL', async () => {
    state.categoryPage = { node, trail: [node], children: [], templates: [] }
    const meta = await categoryMetadata(cat('landing-pages'))
    expect(meta.alternates?.canonical).toBe('/templates/categories/landing-pages')
    expect(meta.title).toBe('Landing pages templates for Payload CMS — Payload Directory')
  })
})
