import { allowedReadmeImageUrl, githubAttachmentId } from '@/lib/directory/markdown'

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
  // A trailing dot (FQDN form) or an empty label would slip past the suffix checks below.
  if (host.endsWith('.') || host.split('.').some((label) => label === '')) return null
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return null
  // IPv4 literal (any all-numeric last label also covers shorthand forms the URL parser would normalise).
  if (/^\d+$/.test(host.split('.').pop() ?? '')) return null
  return url.href.length > MAX_URL_CHARS ? null : url.href
}

export type VideoRef = { provider: 'youtube' | 'vimeo' | 'loom' | 'github'; id: string }

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export { githubAttachmentId }
/** GitHub's signed, short-lived S3 link for an attachment: `…/<user id>/<number>-<asset id>.<ext>?X-Amz-…`. */
const GITHUB_ASSET_S3_HOST = /^github-production-user-asset-[0-9a-f]+\.s3\.amazonaws\.com$/
const GITHUB_ASSET_S3_FILE = /^\d+-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(?:mp4|webm|mov)$/i

/** The stable URL of a video attached on GitHub (README drag-and-drop); GitHub redirects it to a fresh signed link. */
export const githubAttachmentUrl = (id: string) => `https://github.com/user-attachments/assets/${id.toLowerCase()}`

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
  if (host === 'github.com') {
    const id = githubAttachmentId(url.href)
    return id ? { provider: 'github', id } : null
  }
  // The expiring S3 link GitHub hands out when a video plays: stored as the stable attachment URL instead.
  if (GITHUB_ASSET_S3_HOST.test(host) && segments.length === 2 && /^\d+$/.test(segments[0])) {
    const m = GITHUB_ASSET_S3_FILE.exec(segments[1])
    return m ? { provider: 'github', id: m[1].toLowerCase() } : null
  }
  return null
}

/**
 * The first video a README attaches on GitHub: a link to `github.com/user-attachments/assets/<id>` whose text is a
 * video file name (`[demo.webm](…)`), or the bare URL on its own line (what GitHub inserts on drag-and-drop).
 * Image syntax (`![…](…)`) is skipped: the same URL form also serves images.
 */
export function firstReadmeVideo(readme: string | null | undefined): VideoRef | null {
  if (!readme) return null
  const source = readme.length > 200_000 ? readme.slice(0, 200_000) : readme
  const URL_RE = 'https://github\\.com/user-attachments/assets/([0-9a-fA-F-]{36})'
  const linked = new RegExp(`(?<!!)\\[[^\\]\\n]{0,200}\\.(?:mp4|webm|mov)\\]\\(\\s*${URL_RE}\\s*\\)`, 'i')
  const bare = new RegExp(`^[ \\t]*<?${URL_RE}>?[ \\t]*$`, 'im')
  const hits = [linked.exec(source), bare.exec(source)].filter((m): m is RegExpExecArray => m !== null && ASSET_ID.test(m[1]))
  if (!hits.length) return null
  const first = hits.reduce((a, b) => (a.index <= b.index ? a : b))
  return { provider: 'github', id: first[1].toLowerCase() }
}

/** Hosts whose links are never a demo: the repository's own pages. */
const NOT_A_DEMO = /(^|\.)github\.com$/

/**
 * A template's repository Website (GitHub About → Website) as a fallback: the demo link when it is a site, the video when
 * it is a YouTube/Vimeo/Loom/GitHub video. Never for official templates (their Website is the Payload site), never a
 * link back to GitHub, and only when the admin or owner has not set one (callers check that). Never fetched.
 */
export function websiteFallback(homepage: string | null | undefined, isOfficial: boolean): { demoUrl: string | null; video: VideoRef | null } {
  if (isOfficial || !homepage) return { demoUrl: null, video: null }
  const video = parseVideoUrl(homepage)
  if (video) return { demoUrl: null, video }
  const demo = parseDemoUrl(homepage)
  if (!demo || NOT_A_DEMO.test(new URL(demo).hostname.toLowerCase())) return { demoUrl: null, video: null }
  return { demoUrl: demo, video: null }
}

export function canonicalVideoUrl(ref: VideoRef): string {
  if (ref.provider === 'github') return githubAttachmentUrl(ref.id)
  if (ref.provider === 'youtube') return `https://www.youtube.com/watch?v=${ref.id}`
  if (ref.provider === 'vimeo') return `https://vimeo.com/${ref.id}`
  return `https://www.loom.com/share/${ref.id}`
}

/** For `github`, the stable attachment URL played by a native <video> (no iframe). */
export function embedUrlFor(ref: VideoRef): string {
  if (ref.provider === 'github') return githubAttachmentUrl(ref.id)
  if (ref.provider === 'youtube') return `https://www.youtube-nocookie.com/embed/${ref.id}`
  if (ref.provider === 'vimeo') return `https://player.vimeo.com/video/${ref.id}?dnt=1`
  return `https://www.loom.com/embed/${ref.id}`
}

/** A template's stored Payload range for display: sync stores the resolved version for official templates (Ruling 10); a
 * leftover `workspace:*` means nothing outside the monorepo, so it is shown as unknown (null). */
export function shownVersionRange(range: string | null | undefined): string | null {
  return range && !range.startsWith('workspace:') ? range : null
}

export function getStartedFor(t: { isOfficial: boolean; slug: string; fullName: string; path: string | null; isTemplateRepo: boolean }): { kind: 'command' | 'link'; value: string } {
  if (t.isOfficial) return { kind: 'command', value: `npx create-payload-app -t ${t.slug}` }
  if (t.path) return { kind: 'command', value: `npx giget@latest gh:${t.fullName}/${t.path} my-app` }
  if (t.isTemplateRepo) return { kind: 'link', value: `https://github.com/${t.fullName}/generate` }
  return { kind: 'command', value: `git clone https://github.com/${t.fullName}.git` }
}

/** The stored README fallback image only when https and allow-listed (re-checked on read), else null. */
export function storedFallbackImage(url: string | null | undefined): string | null {
  return url && url.startsWith('https://') ? allowedReadmeImageUrl(url) : null
}

/** The stored fallback image only when https and allow-listed; otherwise GitHub's social card for the repo. */
export function fallbackImageFor(t: { fallbackImageUrl?: string | null; fullName: string }): string {
  return storedFallbackImage(t.fallbackImageUrl) ?? `https://opengraph.githubassets.com/1/${t.fullName}`
}
