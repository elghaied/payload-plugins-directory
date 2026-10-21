import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SiteFooter } from '@/components/SiteFooter'

describe('SiteFooter', () => {
  const html = renderToStaticMarkup(createElement(SiteFooter))
  it('links to About and the other pages hidden from the phone navbar', () => {
    for (const href of ['/about', '/trending', '/stats', '/submit', '/feed.xml']) expect(html).toContain(`href="${href}"`)
  })
  it('links to both GitHub repositories', () => {
    expect(html).toContain('github.com/elghaied/payload-plugins-directory')
    expect(html).toContain('github.com/payloadcms/payload')
  })
})
