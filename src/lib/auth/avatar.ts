/** Only GitHub's avatar CDN is ever rendered as an image source; anything else (or malformed) is dropped. */
export function safeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.hostname !== 'avatars.githubusercontent.com') return null
    if (url.username || url.password || url.port) return null
    return url.toString()
  } catch {
    return null
  }
}

/** Sign-in link for the navbar; the server re-sanitises returnTo (same-site relative paths only). */
export function signInHref(pathname: string | null): string {
  const path = pathname && pathname.startsWith('/') && !pathname.startsWith('//') && !pathname.startsWith('/auth') ? pathname : null
  return path ? `/auth/github?returnTo=${encodeURIComponent(path)}` : '/auth/github'
}
