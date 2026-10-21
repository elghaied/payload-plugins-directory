export const BADGE_LABEL = 'Payload Directory'
export const BADGE_CACHE_CONTROL = 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=3600'
const MISS_CACHE_CONTROL = 'public, max-age=300, s-maxage=300'
const GREY = '#9f9f9f'

export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/** Same bands as getHealthDisplayFromScore (75/50/25), in shields.io colours. */
export function badgeColor(score: number | null | undefined): string {
  if (score == null) return GREY
  if (score >= 75) return '#4c1'
  if (score >= 50) return '#97ca00'
  if (score >= 25) return '#dfb317'
  return '#fe7d37'
}

// Verdana 11px averages ~6.5px per character; 10px horizontal padding per half.
const textWidth = (text: string) => Math.round(text.length * 6.5) + 10

export function buildBadgeSvg({
  label = BADGE_LABEL,
  message,
  color,
  href,
}: {
  label?: string
  message: string
  color: string
  href?: string
}): string {
  const fill = /^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(color) ? color : GREY
  const lw = textWidth(label)
  const mw = textWidth(message)
  const w = lw + mw
  const l = escapeXml(label)
  const m = escapeXml(message)
  const body =
    `<linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient>` +
    `<clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath>` +
    `<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="${fill}"/><rect width="${w}" height="20" fill="url(#s)"/></g>` +
    `<g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">` +
    `<text x="${lw / 2}" y="14">${l}</text><text x="${lw + mw / 2}" y="14">${m}</text></g>`
  const linked = href ? `<a href="${escapeXml(href)}">${body}</a>` : body
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${m}"><title>${l}: ${m}</title>${linked}</svg>`
}

export function parseBadgeFile(file: string): string | null {
  const match = /^([A-Za-z0-9][A-Za-z0-9._-]{0,200})\.svg$/.exec(file)
  return match ? match[1] : null
}

const BADGE_HEADERS = {
  'Content-Type': 'image/svg+xml; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
}

function notFoundBadge(): Response {
  return new Response(buildBadgeSvg({ message: 'not found', color: GREY }), {
    status: 404,
    headers: { ...BADGE_HEADERS, 'Cache-Control': MISS_CACHE_CONTROL },
  })
}

/** Badge for a listed template; null (unknown, hidden or trashed) renders the shared "not found" badge. */
export function templateBadgeResponse({
  template,
  origin,
}: {
  template: { slug: string; isOfficial?: boolean | null } | null
  origin: string
}): Response {
  if (!template) return notFoundBadge()
  const svg = buildBadgeSvg({
    message: template.isOfficial ? 'official template' : 'template',
    color: '#0a7ea4',
    href: origin ? `${origin}/templates/${encodeURIComponent(template.slug)}` : undefined,
  })
  return new Response(svg, { status: 200, headers: { ...BADGE_HEADERS, 'Cache-Control': BADGE_CACHE_CONTROL } })
}

export function badgeResponse({
  plugin,
  origin,
}: {
  plugin: { slug: string; healthScore?: number | null } | null
  origin: string
}): Response {
  const headers = BADGE_HEADERS
  if (!plugin) return notFoundBadge()
  const score = plugin.healthScore == null ? null : Math.round(plugin.healthScore)
  const svg = buildBadgeSvg({
    message: `health ${score ?? 'n/a'}`,
    color: badgeColor(score),
    // No origin configured: render the badge unlinked rather than guessing a host.
    href: origin ? `${origin}/plugins/${encodeURIComponent(plugin.slug)}` : undefined,
  })
  return new Response(svg, { status: 200, headers: { ...headers, 'Cache-Control': BADGE_CACHE_CONTROL } })
}
