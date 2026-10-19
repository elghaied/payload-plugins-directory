import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PluginAiOverview } from '@/components/PluginAiOverview'

const render = (props: Parameters<typeof PluginAiOverview>[0]) => renderToStaticMarkup(createElement(PluginAiOverview, props))

describe('PluginAiOverview', () => {
  it('renders AI text as escaped plain text — no markup, no links', () => {
    const html = render({
      summary: '<img src=x onerror=alert(1)> [click](https://evil.example)',
      features: ['<script>alert(1)</script>Fast'],
      useCases: ['<a href="https://evil.example">Use it</a>'],
      generated: true,
    })
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toMatch(/<script|<img|<a\s/)
    expect(html).toContain('Summary generated from the README')
    expect(html).toContain('Features')
    expect(html).toContain('Use cases')
  })
  it('omits the note when admins curated the text, and renders nothing without AI text', () => {
    expect(render({ summary: 'Curated.', features: [], useCases: [], generated: false })).not.toContain('generated from the README')
    expect(render({ features: [], useCases: [], generated: true })).toBe('')
  })
})
