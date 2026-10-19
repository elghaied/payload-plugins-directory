export const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/trending', label: 'Trending' },
  { href: '/stats', label: 'Stats' },
  { href: '/about', label: 'About' },
] as const

export function isActiveLink(href: string, pathname: string | null): boolean {
  if (!pathname) return false
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
