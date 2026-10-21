import { allowedReadmeImageUrl } from '@/lib/directory/markdown'

const MAX_URL_CHARS = 500

function parseHttps(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed || trimmed.length > MAX_URL_CHARS) return null
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null
  return url
}

/** The normalized https demo URL, or null. Never fetched by the server. */
export function parseDemoUrl(raw: unknown): string | null {
  const url = parseHttps(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  if (!host.includes('.') || host.startsWith('[') || host.includes(':')) return null
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  // IPv4 literal (any all-numeric last label also covers shorthand forms the URL parser would normalise).
  if (/^\d+$/.test(host.split('.').pop() ?? '')) return null
  return url.href.length > MAX_URL_CHARS ? null : url.href
}

export type VideoRef = { provider: 'youtube' | 'vimeo' | 'loom'; id: string }

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'])
const VIMEO_HOSTS = new Set(['vimeo.com', 'www.vimeo.com'])
const LOOM_HOSTS = new Set(['loom.com', 'www.loom.com'])
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/

export function parseVideoUrl(raw: unknown): VideoRef | null {
  const url = parseHttps(raw)
  if (!url) return null
  const host = url.hostname.toLowerCase()
  const segments = url.pathname.split('/').filter(Boolean)
  if (YOUTUBE_HOSTS.has(host)) {
    let id: string | null = null
    if (host === 'youtu.be') id = segments.length === 1 ? segments[0] : null
    else if (segments[0] === 'watch' && segments.length === 1) id = url.searchParams.get('v')
    else if ((segments[0] === 'shorts' || segments[0] === 'embed') && segments.length === 2) id = segments[1]
    return id && YOUTUBE_ID.test(id) ? { provider: 'youtube', id } : null
  }
  if (VIMEO_HOSTS.has(host)) return segments.length === 1 && /^\d+$/.test(segments[0]) ? { provider: 'vimeo', id: segments[0] } : null
  if (LOOM_HOSTS.has(host)) return segments.length === 2 && segments[0] === 'share' && /^[0-9a-f]{32}$/i.test(segments[1]) ? { provider: 'loom', id: segments[1].toLowerCase() } : null
  return null
}

export function canonicalVideoUrl(ref: VideoRef): string {
  if (ref.provider === 'youtube') return `https://www.youtube.com/watch?v=${ref.id}`
  if (ref.provider === 'vimeo') return `https://vimeo.com/${ref.id}`
  return `https://www.loom.com/share/${ref.id}`
}

export function embedUrlFor(ref: VideoRef): string {
  if (ref.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${ref.id}`
  if (ref.provider === 'vimeo') return `https://player.vimeo.com/video/${ref.id}?dnt=1`
  return `https://www.loom.com/embed/${ref.id}`
}

export function getStartedFor(t: { isOfficial: boolean; slug: string; fullName: string; path: string | null; isTemplateRepo: boolean }): { kind: 'command' | 'link'; value: string } {
  if (t.isOfficial) return { kind: 'command', value: `npx create-payload-app -t ${t.slug}` }
  if (t.path) return { kind: 'command', value: `npx giget@latest gh:${t.fullName}/${t.path} my-app` }
  if (t.isTemplateRepo) return { kind: 'link', value: `https://github.com/${t.fullName}/generate` }
  return { kind: 'command', value: `git clone https://github.com/${t.fullName}.git` }
}

/** The stored fallback image only when https and allow-listed; otherwise GitHub's social card for the repo. */
export function fallbackImageFor(t: { fallbackImageUrl?: string | null; fullName: string }): string {
  const stored = t.fallbackImageUrl
  if (stored && stored.startsWith('https://')) {
    const ok = allowedReadmeImageUrl(stored)
    if (ok) return ok
  }
  return `https://opengraph.githubassets.com/1/${t.fullName}`
}
