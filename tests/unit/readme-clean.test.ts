import { describe, expect, it } from 'vitest'
import { cleanStoredReadmeHtml } from '@/lib/directory/readmeClean'
import { renderReadmeHtml } from '@/lib/directory/readmeHtml'

const repo = { fullName: 'acme/plugins', defaultBranch: 'main', path: 'packages/seo' }

describe('cleanStoredReadmeHtml (re-sanitize on read)', () => {
  it('removes everything dangerous from a hand-written stored value', () => {
    const evil =
      '<p>ok</p><img src="https://img.shields.io/x.svg" onerror="alert(1)"><script>alert(1)</script>' +
      '<a href="javascript:alert(1)">x</a><iframe src="https://evil.example"></iframe><style>body{display:none}</style>' +
      '<p onclick="x()" style="position:fixed">y</p><a href="data:text/html,<script>alert(1)</script>">d</a><form action="/x"><input type="text"></form>'
    const clean = cleanStoredReadmeHtml(evil)!
    expect(clean).not.toMatch(/<script|<iframe|<style|<form|onerror|onclick|javascript:|style=|data:text/i)
    expect(clean).toContain('<p>ok</p>')
    expect(clean).not.toContain('display:none')
  })
  it('does not double-prefix ids that are already prefixed, and keeps in-page anchors working', () => {
    const clean = cleanStoredReadmeHtml('<h2 id="user-content-usage">Usage</h2><p><a href="#user-content-usage">go</a></p>')!
    expect(clean).toContain('id="user-content-usage"')
    expect(clean).not.toContain('user-content-user-content')
  })
  it('M1: applies the write-time clobber rules to unprefixed ids, names and aria references', () => {
    const clean = cleanStoredReadmeHtml('<p id="__next">a</p><img name="cookie" src="https://img.shields.io/x.svg"><a name="top">t</a><table aria-describedby="main aria-x"><tr><td>c</td></tr></table>')!
    expect(clean).not.toMatch(/id="__next"|name="cookie"|name="top"|aria-describedby="main/)
    expect(clean).toContain('id="user-content-__next"')
    expect(clean).toContain('name="user-content-cookie"')
    expect(clean).toContain('aria-describedby="user-content-main user-content-aria-x"')
  })
  it('M1: applies the image host allow-list and srcset checks', () => {
    const clean = cleanStoredReadmeHtml(
      '<img src="https://evil.example/p.png" alt="tracker"><img src="http://img.shields.io/a.svg"><picture><source srcset="https://evil.example/t.png 1x, https://camo.githubusercontent.com/b.png 2x"><img src="//evil.example/q.png"></picture><img src="/relative.png">',
    )!
    expect(clean).not.toContain('evil.example')
    expect(clean).not.toContain('relative.png')
    expect(clean).toContain('src="https://img.shields.io/a.svg"')
    expect(clean).toContain('srcset="https://camo.githubusercontent.com/b.png 2x"')
    expect(clean).toContain('tracker')
  })
  it('M1: forces referrerpolicy, rel and target', () => {
    const clean = cleanStoredReadmeHtml('<img src="https://img.shields.io/a.svg" referrerpolicy="unsafe-url"><a href="https://example.com" rel="opener">x</a><a href="/admin">rel</a>')!
    expect(clean).toContain('referrerpolicy="no-referrer"')
    expect(clean).toContain('rel="nofollow ugc noopener noreferrer" target="_blank"')
    expect(clean).not.toContain('unsafe-url')
    expect(clean).not.toContain('href="/admin"')
  })
  it('is the identity on what the write pipeline produces (nothing legitimate is stripped on read)', () => {
    const readme = [
      '# Title', '', '[a link](docs/g.md) and [site](https://example.com) and [jump](#title) and [//proto](//example.com/x)', '',
      '![shot](img/a.png) ![badge](https://img.shields.io/npm/v/x.svg)', '',
      '<p align="center"><picture><source srcset="dark.png" media="(prefers-color-scheme: dark)"><img src="logo.png" width="200" alt="logo"></picture></p>', '',
      '<details><summary>More</summary>', '', 'text', '', '</details>', '',
      '| a | b |', '|---|---|', '| 1 | 2 |', '',
      '- [x] done', '- [ ] todo', '', 'Footnote[^1]', '', '[^1]: the note', '', '```ts', 'const a = 1', '```', '', '<a name="top"></a>',
    ].join('\n')
    const stored = renderReadmeHtml(readme, repo)!
    expect(stored).toContain('target="_blank"')
    expect(cleanStoredReadmeHtml(stored)).toBe(stored)
  })
  it('cold time at the 400k storage limit', () => {
    const unit = '<h2 id="user-content-s">Section</h2><p>Some <strong>bold</strong> text with <a href="https://example.com/x" target="_blank" rel="nofollow ugc noopener noreferrer">a link</a> and <code>code</code>.</p><ul><li>one</li><li>two</li></ul>\n'
    const html = unit.repeat(Math.floor(400_000 / unit.length))
    expect(html.length).toBeLessThanOrEqual(400_000)
    const start = performance.now()
    const out = cleanStoredReadmeHtml(html)
    const ms = performance.now() - start
    console.log(`cold re-sanitize of ${html.length} chars: ${Math.round(ms)} ms`)
    expect(out).not.toBeNull()
    expect(ms).toBeLessThan(2_000)
  })
})
