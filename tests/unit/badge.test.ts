import { describe, expect, it } from 'vitest'
import { BADGE_CACHE_CONTROL, badgeColor, badgeResponse, buildBadgeSvg, escapeXml, parseBadgeFile } from '@/lib/badge'

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml(`<a href="x" title='y'>&</a>`)).toBe('&lt;a href=&quot;x&quot; title=&apos;y&apos;&gt;&amp;&lt;/a&gt;')
  })
})

describe('buildBadgeSvg', () => {
  it('renders "Payload Directory" and the message', () => {
    const svg = buildBadgeSvg({ message: 'health 87', color: badgeColor(87) })
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/)
    expect(svg).toContain('>Payload Directory</text>')
    expect(svg).toContain('>health 87</text>')
    expect(svg).toContain('aria-label="Payload Directory: health 87"')
  })
  it('escapes every rendered string, including the link', () => {
    const svg = buildBadgeSvg({
      label: '<script>alert(1)</script>',
      message: '"><img onerror=x>',
      color: '#4c1',
      href: 'https://x.dev/plugins/a"onload="alert(1)',
    })
    expect(svg).not.toContain('<script>')
    expect(svg).not.toContain('<img')
    expect(svg).not.toContain('"onload="')
    expect(svg).toContain('&lt;script&gt;')
  })
  it('refuses a non-hex colour', () => {
    expect(buildBadgeSvg({ message: 'm', color: 'red" onload="x' })).toContain('fill="#9f9f9f"')
  })
  it('grows with the text', () => {
    const width = (s: string) => Number(/width="(\d+)"/.exec(s)![1])
    expect(width(buildBadgeSvg({ message: 'health 100', color: '#4c1' }))).toBeGreaterThan(width(buildBadgeSvg({ message: 'h', color: '#4c1' })))
  })
})

describe('badgeColor', () => {
  it.each([[100, '#4c1'], [75, '#4c1'], [74, '#97ca00'], [50, '#97ca00'], [25, '#dfb317'], [24, '#fe7d37'], [null, '#9f9f9f']] as const)(
    '%s → %s',
    (score, color) => expect(badgeColor(score)).toBe(color),
  )
})

describe('parseBadgeFile', () => {
  it.each([
    ['684372049-translator.svg', '684372049-translator'],
    ['payloadcms-plugin-seo.svg', 'payloadcms-plugin-seo'],
    ['x.png', null],
    ['.svg', null],
    ['../etc.svg', null],
    ['a b.svg', null],
  ])('%s → %s', (file, slug) => expect(parseBadgeFile(file)).toBe(slug))
})

describe('badgeResponse', () => {
  it('serves a cacheable SVG linking to the listing', async () => {
    const res = badgeResponse({ plugin: { slug: 'seo', healthScore: 81.6 }, origin: 'https://payloaddirectory.dev' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe(BADGE_CACHE_CONTROL)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600')
    expect(res.headers.get('content-security-policy')).toBe("default-src 'none'")
    const body = await res.text()
    expect(body).toContain('health 82')
    expect(body).toContain('href="https://payloaddirectory.dev/plugins/seo"')
  })
  it('serves a short-lived "not found" badge with 404', async () => {
    const res = badgeResponse({ plugin: null, origin: 'https://payloaddirectory.dev' })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300, s-maxage=300')
    expect(await res.text()).toContain('>not found</text>')
  })
  it('renders unlinked when no origin is configured and never invents a host', async () => {
    const body = await badgeResponse({ plugin: { slug: 'seo', healthScore: 50 }, origin: '' }).text()
    expect(body).not.toContain('<a ')
    expect(body).not.toContain('payloaddirectory.dev')
  })
  it('links only to the given origin (staging stays staging)', async () => {
    const body = await badgeResponse({ plugin: { slug: 'seo', healthScore: 50 }, origin: 'https://staging.example.test' }).text()
    expect(body).toContain('href="https://staging.example.test/plugins/seo"')
    expect(body).not.toContain('payloaddirectory.dev')
  })
  it('escapes the slug and score in the output', async () => {
    const body = await badgeResponse({ plugin: { slug: `a"b'<c>&`, healthScore: 50 }, origin: 'https://x.test' }).text()
    expect(body).not.toMatch(/href="[^"]*"[^>]*"[^>]*>.*"b'/)
    expect(body).not.toContain('<c>')
  })
  it('says "health n/a" when there is no score yet', async () => {
    expect(await badgeResponse({ plugin: { slug: 's', healthScore: null }, origin: 'https://x' }).text()).toContain('health n/a')
  })
})
