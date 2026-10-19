import { describe, expect, it } from 'vitest'
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { safeAvatarUrl, signInHref } from '@/lib/auth/avatar'
import { AccountMenuView } from '@/components/AccountMenu'
import { DropdownMenuContent } from '@/components/ui/dropdown-menu'

describe('safeAvatarUrl', () => {
  it('accepts the GitHub avatar CDN over https', () => {
    expect(safeAvatarUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe('https://avatars.githubusercontent.com/u/1?v=4')
  })
  it.each([
    'http://avatars.githubusercontent.com/u/1',
    'https://evil.test/a.png',
    'https://avatars.githubusercontent.com.evil.test/a.png',
    'https://user@avatars.githubusercontent.com/a.png',
    'https://avatars.githubusercontent.com:8443/a.png',
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    '',
    null,
    42,
  ])('rejects %s', (v) => expect(safeAvatarUrl(v)).toBeNull())
})

describe('signInHref', () => {
  it('returns to the current path', () => expect(signInHref('/plugins/seo')).toBe('/auth/github?returnTo=%2Fplugins%2Fseo'))
  it('keeps the query string so filters survive sign-in', () => {
    expect(signInHref('/', '?q=seo&sort=stars')).toBe('/auth/github?returnTo=%2F%3Fq%3Dseo%26sort%3Dstars')
    expect(signInHref('/plugins/seo', '')).toBe('/auth/github?returnTo=%2Fplugins%2Fseo')
    expect(signInHref('/auth/error', '?reason=x')).toBe('/auth/github')
  })
  it('omits returnTo for unsafe or auth paths', () => {
    expect(signInHref('//evil')).toBe('/auth/github')
    expect(signInHref('/auth/error')).toBe('/auth/github')
    expect(signInHref(null)).toBe('/auth/github')
  })
})

const html = (session: Parameters<typeof AccountMenuView>[0]['session']) =>
  renderToStaticMarkup(createElement(AccountMenuView, { session, pathname: '/', search: '', logoutFormRef: null }))

describe('AccountMenuView session states', () => {
  it('loading: renders only an inert placeholder, no identity or controls', () => {
    const out = html(undefined)
    expect(out).toContain('aria-hidden')
    expect(out).not.toContain('<button')
    expect(out).not.toContain('<form')
  })
  it('signed out: trigger is labelled Sign in, with no logout form', () => {
    const out = html(null)
    expect(out).toContain('aria-label="Sign in"')
    expect(out).toContain('Sign in')
    expect(out).not.toContain('<form')
  })
  it('signed in: trigger names the account and the logout form is present', () => {
    const out = html({ login: 'octo', avatarUrl: null })
    expect(out).toContain('aria-label="Account menu for @octo"')
    expect(out).toMatch(/<form[^>]*action="\/auth\/logout"[^>]*method="post"/)
  })
  it('signed in: the logout form is a sibling of the menu, not inside DropdownMenuContent (F18)', () => {
    const tree = AccountMenuView({ session: { login: 'octo', avatarUrl: null }, pathname: '/', search: '', logoutFormRef: null })
    const found = { form: false, formInsideContent: false }
    const walk = (node: ReactNode, insideContent: boolean) => {
      if (Array.isArray(node)) return node.forEach((n) => walk(n, insideContent))
      if (!isValidElement(node)) return
      const el = node as ReactElement<{ children?: ReactNode }>
      if (el.type === 'form') {
        found.form = true
        if (insideContent) found.formInsideContent = true
      }
      walk(el.props.children, insideContent || el.type === DropdownMenuContent)
    }
    walk(tree, false)
    expect(found).toEqual({ form: true, formInsideContent: false })
  })
})
