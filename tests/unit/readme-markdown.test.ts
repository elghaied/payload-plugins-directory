import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ReadmeView } from '@/components/ReadmeMarkdown'
import { README_MARKDOWN_MAX, isPathologicallyNested, renderReadmeTree } from '@/lib/directory/readmeTree'
import { ALLOWED_README_IMAGE_HOSTS, isAllowedReadmeImageUrl, rewriteReadmeUrl } from '@/lib/directory/markdown'

const repo = { fullName: 'acme/plugins', defaultBranch: 'main' }
const mono = { fullName: 'acme/plugins', defaultBranch: 'main', path: 'packages/seo' }

const render = (source: string, r = repo) => renderToStaticMarkup(createElement(ReadmeView, { tree: renderReadmeTree(source, r), source }))

describe('README sanitizer', () => {
  it('removes <script> elements and their content', () => {
    const html = render('hi\n\n<script>alert(1)</script>\n\nbye')
    expect(html).not.toMatch(/<script/i)
    expect(html).toContain('bye')
  })
  it('strips onerror and every other event handler', () => {
    const html = render('<img src="x.png" onerror="alert(1)" onload="alert(2)"><p onclick="x()">t</p>')
    expect(html).not.toMatch(/onerror|onload|onclick/i)
    expect(html).toContain('<img')
  })
  it('drops javascript: links, including obfuscated ones', () => {
    for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '&#106;avascript:alert(1)']) {
      const html = render(`<a href="${href}">x</a>\n\n[y](${href.replace(/\t/g, '')})`)
      expect(html.toLowerCase()).not.toContain('javascript:')
      expect(html).not.toMatch(/href="java/i)
    }
  })
  it('drops data: URLs on links and images', () => {
    const html = render('<a href="data:text/html,<script>alert(1)</script>">x</a>\n\n<img src="data:image/svg+xml;base64,AAAA">')
    expect(html).not.toMatch(/data:/i)
  })
  it('removes <iframe>, <style>, <form> and non-checkbox inputs', () => {
    const html = render('<iframe src="https://evil.example"></iframe><style>body{display:none}</style><form action="/x"><input type="text" name="a"><button>go</button></form>')
    expect(html).not.toMatch(/<iframe|<style|<form|type="text"/i)
    expect(html).not.toContain('display:none')
  })
  it('strips inline style attributes', () => {
    expect(render('<p style="position:fixed;inset:0">x</p>')).not.toMatch(/style=/i)
  })
  it('prefixes ids and names so they cannot clobber page globals', () => {
    const html = render('<div id="__next">x</div><a name="top">y</a><h2 id="root">z</h2>')
    expect(html).not.toMatch(/id="__next"|id="root"|name="top"/)
    expect(html).toContain('id="user-content-__next"')
  })
  it('keeps the HTML READMEs rely on', () => {
    const html = render(
      '<p align="center"><picture><source srcset="dark.png" media="(prefers-color-scheme: dark)"><img src="logo.png" width="200" alt="logo"></picture></p>\n\n<details><summary>More</summary>\n\ntext\n\n</details>\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nline<br>break',
    )
    expect(html).toMatch(/<p align="center">/)
    expect(html).toContain('<picture>')
    expect(html).toContain('<details>')
    expect(html).toContain('<table>')
    expect(html).toContain('<br/>')
  })
  it('renders task-list checkboxes disabled and nothing else interactive', () => {
    const html = render('- [x] done\n- [ ] todo\n\n<input type="checkbox" checked>')
    expect(html.match(/<input/g)?.length).toBe(2)
    expect(html.match(/disabled/g)?.length).toBe(2)
  })
  it('does not let a hostile srcset through', () => {
    const html = render('<img srcset="javascript:alert(1) 1x, pic.png 2x" src="a.png">')
    expect(html.toLowerCase()).not.toContain('javascript:')
    expect(html).toContain('https://raw.githubusercontent.com/acme/plugins/main/pic.png 2x')
  })
})

describe('README image tracking protection', () => {
  it('drops an image from a host that is not allow-listed and shows its alt text', () => {
    const html = render('![build status](https://tracker.evil.example/p.png?u=1)')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('tracker.evil.example')
    expect(html).toContain('build status')
  })
  it('replaces an alt-less blocked image with a plain link that never loads automatically', () => {
    const html = render('<img src="https://tracker.evil.example/p.png">')
    expect(html).not.toContain('<img')
    expect(html).toContain('href="https://tracker.evil.example/p.png"')
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"')
    expect(html).toContain('[image]')
  })
  it('keeps allow-listed hosts and adds no-referrer to the img', () => {
    const html = render('![ci](https://img.shields.io/npm/v/x.svg)\n\n![shot](docs/a.png)')
    expect(html).toContain('src="https://img.shields.io/npm/v/x.svg"')
    expect(html.match(/referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/gi)?.length).toBe(2)
  })
  it('filters bad srcset candidates and keeps the good one, with no-referrer on img and source', () => {
    const html = render('<picture><source srcset="https://evil.example/a.png 1x, https://camo.githubusercontent.com/b.png 2x"><img src="https://img.shields.io/x.svg"></picture>')
    expect(html).not.toContain('evil.example')
    expect(html).toContain('srcSet="https://camo.githubusercontent.com/b.png 2x"')
    expect(html.match(/referrerPolicy="no-referrer"/gi)?.length).toBe(2)
  })
  it('removes a <source> whose candidates are all blocked', () => {
    const html = render('<picture><source srcset="https://evil.example/a.png"><img src="https://img.shields.io/x.svg"></picture>')
    expect(html).not.toContain('<source')
  })
  it('drops protocol-relative images', () => {
    const html = render('![x](//evil.com/x.png)\n\n<img src="//evil.com/y.png">')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('evil.com/x.png"')
  })
  it('handles uppercase and mixed-case hosts, and rejects userinfo tricks', () => {
    expect(isAllowedReadmeImageUrl('https://IMG.Shields.IO/x.svg')).toBe(true)
    expect(isAllowedReadmeImageUrl('HTTPS://Raw.GithubUserContent.com/x')).toBe(true)
    expect(isAllowedReadmeImageUrl('https://raw.githubusercontent.com@evil.com/x.png')).toBe(false)
    expect(isAllowedReadmeImageUrl('https://raw.githubusercontent.com.evil.com/x.png')).toBe(false)
    expect(render('<img src="https://IMG.Shields.IO/x.svg">')).toContain('<img')
  })
  it('restricts github.com and vercel.com to their image paths', () => {
    expect(isAllowedReadmeImageUrl('https://github.com/user-attachments/assets/abc')).toBe(true)
    expect(isAllowedReadmeImageUrl('https://github.com/o/r/raw/main/a.png')).toBe(true)
    expect(isAllowedReadmeImageUrl('https://github.com/o/r/issues/1')).toBe(false)
    expect(isAllowedReadmeImageUrl('https://vercel.com/button')).toBe(true)
    expect(isAllowedReadmeImageUrl('https://vercel.com/evil')).toBe(false)
  })
  it('allow-lists exactly the agreed hosts', () => {
    expect(Object.keys(ALLOWED_README_IMAGE_HOSTS).sort()).toEqual([
      'app.codacy.com', 'avatars.githubusercontent.com', 'badge.fury.io', 'badgen.net', 'camo.githubusercontent.com', 'codecov.io',
      'coveralls.io', 'deploy.workers.cloudflare.com', 'github.com', 'img.shields.io', 'nodei.co', 'opengraph.githubassets.com',
      'private-user-images.githubusercontent.com', 'raw.githubusercontent.com', 'shields.io', 'user-images.githubusercontent.com',
      'vercel.com', 'www.npmjs.com',
    ])
  })
})

describe('README rendering', () => {
  it('opens external links safely', () => {
    const html = render('[site](https://example.com/x)')
    expect(html).toContain('href="https://example.com/x"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="nofollow ugc noopener noreferrer"')
  })
  it('keeps anchors in-page (pointed at the prefixed id), without target', () => {
    const html = render('[jump](#usage)')
    expect(html).toContain('href="#user-content-usage"')
    expect(html).not.toContain('target=')
  })
  it('lazy-loads images', () => {
    const html = render('![a](https://img.shields.io/a.png)')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
  })
  it('demotes headings below the page h1', () => {
    const html = render('# Title\n\n###### Deep')
    expect(html).toContain('<h2 id="user-content-title">Title</h2>')
    expect(html).toContain('<h6 id="user-content-deep">Deep</h6>')
  })
  it('rewrites relative images and links against the repository', () => {
    const html = render('![shot](docs/shot.png)\n\n[guide](docs/guide.md#x)\n\n<img src="/assets/a.png">')
    expect(html).toContain('src="https://raw.githubusercontent.com/acme/plugins/main/docs/shot.png"')
    expect(html).toContain('href="https://github.com/acme/plugins/blob/main/docs/guide.md#x"')
    expect(html).toContain('src="https://raw.githubusercontent.com/acme/plugins/main/assets/a.png"')
  })
  it('resolves monorepo relative URLs against the plugin directory', () => {
    const html = render('![shot](./img/shot.png)\n\n[license](../../LICENSE)', mono)
    expect(html).toContain('src="https://raw.githubusercontent.com/acme/plugins/main/packages/seo/img/shot.png"')
    expect(html).toContain('href="https://github.com/acme/plugins/blob/main/LICENSE"')
  })
  it('leaves absolute URLs untouched', () => {
    const html = render('![a](https://img.shields.io/a.png)\n\n[b](https://github.com/other/repo)', mono)
    expect(html).toContain('src="https://img.shields.io/a.png"')
    expect(html).toContain('href="https://github.com/other/repo"')
  })
})

describe('rewriteReadmeUrl', () => {
  it('never climbs above the repository root', () => {
    expect(rewriteReadmeUrl('../../../../../etc/x.png', 'image', mono)).toBe('https://raw.githubusercontent.com/acme/plugins/main/etc/x.png')
  })
  it('falls back to HEAD without a default branch', () => {
    expect(rewriteReadmeUrl('a.md', 'link', { fullName: 'a/b' })).toBe('https://github.com/a/b/blob/HEAD/a.md')
  })
  it('keeps query strings and protocol-relative URLs', () => {
    expect(rewriteReadmeUrl('a.png?raw=true', 'image', repo)).toBe('https://raw.githubusercontent.com/acme/plugins/main/a.png?raw=true')
    expect(rewriteReadmeUrl('//cdn.example.com/a.png', 'image', repo)).toBe('//cdn.example.com/a.png')
  })
})

describe('hostile nesting (denial of service)', () => {
  const payloads: Record<string, string> = {
    'blockquote x 100k': '>'.repeat(100_000) + ' x',
    'nested list markers': '- '.repeat(2_000) + 'x',
    'div x 2000': '<div>'.repeat(2_000),
    'ordered list markers': '1. '.repeat(500) + 'x',
    'indented list ladder': Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i)}- item`).join('\n'),
  }
  for (const [name, source] of Object.entries(payloads)) {
    it(`falls back to escaped plain text quickly: ${name}`, () => {
      const start = performance.now()
      let html = ''
      expect(() => {
        html = renderToStaticMarkup(createElement(ReadmeView, { tree: renderReadmeTree(source, repo), source }))
      }).not.toThrow()
      expect(performance.now() - start).toBeLessThan(500)
      expect(html).toContain('<pre')
      expect(html).not.toContain('readme-prose')
    })
  }
  it('stays fast on unclosed angle-bracket floods (not nested, rendered as text)', () => {
    for (const source of ['<a '.repeat(30_000), '<'.repeat(50_000) + '>', '[' .repeat(30_000), '*'.repeat(30_000)]) {
      const start = performance.now()
      expect(() => renderToStaticMarkup(createElement(ReadmeView, { tree: renderReadmeTree(source, repo), source }))).not.toThrow()
      expect(performance.now() - start).toBeLessThan(500)
    }
  })
  it('flags depth only above the limit', () => {
    expect(isPathologicallyNested('> '.repeat(20) + 'x')).toBe(false)
    expect(isPathologicallyNested('> '.repeat(21) + 'x')).toBe(true)
    expect(isPathologicallyNested('<div>'.repeat(20))).toBe(false)
    expect(isPathologicallyNested('<div>'.repeat(21))).toBe(true)
    expect(isPathologicallyNested('<div><br><img src=x><p>a</p></div>'.repeat(500))).toBe(false)
  })
  it('renders ordinary nested READMEs as Markdown', () => {
    const html = render('- a\n  - b\n    - c\n\n> quote\n\n<details><summary>s</summary><div><p>x</p></div></details>')
    expect(html).toContain('readme-prose')
    expect(html).toContain('<details>')
  })
  it('caps the rendered input at README_MARKDOWN_MAX', () => {
    const html = render('a'.repeat(README_MARKDOWN_MAX + 500))
    expect(html.match(/a/g)!.length).toBeLessThan(README_MARKDOWN_MAX + 200)
  })
  it('never throws on an error inside the pipeline', () => {
    expect(renderReadmeTree('x'.repeat(10), { fullName: undefined as never })).toBeTypeOf('object')
  })
})

describe('anchors, aria and footnotes', () => {
  it('prefixes aria-describedby and aria-labelledby', () => {
    const html = render('<table aria-describedby="__next" aria-labelledby="main"><tr><td>x</td></tr></table>')
    expect(html).not.toMatch(/aria-describedby="__next"|aria-labelledby="main"/)
    expect(html).toContain('aria-describedby="user-content-__next"')
  })
  it('gives headings ids and points #anchors at them', () => {
    const html = render('[go](#Getting-Started)\n\n## Getting Started\n\n## Getting Started')
    expect(html).toContain('id="user-content-getting-started"')
    expect(html).toContain('id="user-content-getting-started-1"')
    expect(html).toContain('href="#user-content-getting-started"')
  })
  it('points #anchors at <a name> targets', () => {
    const html = render('<a name="top"></a>\n\n[up](#top)')
    expect(html).toContain('name="user-content-top"')
    expect(html).toContain('href="#user-content-top"')
  })
  it('keeps footnote links and ids consistent', () => {
    const html = render('text[^1]\n\n[^1]: the note')
    const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
    const hrefs = [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])
    expect(hrefs.length).toBeGreaterThan(0)
    for (const h of hrefs) expect(ids).toContain(h)
    expect(html).not.toContain('user-content-user-content')
    const labelled = [...html.matchAll(/aria-describedby="([^"]+)"/g)].map((m) => m[1])
    for (const l of labelled) expect(ids).toContain(l)
  })
})

describe('review follow-ups', () => {
  it('rejects encoded dot segments', () => {
    for (const rel of ['%2e%2e/%2e%2e/%2e%2e/evil/repo', '.%2E/.%2e/.%2E/evil/repo', '%2E%2E%2f..%2fx']) {
      const out = rewriteReadmeUrl(rel, 'link', mono)
      expect(out.startsWith('https://github.com/acme/plugins/blob/main/')).toBe(true)
      expect(out.toLowerCase()).not.toContain('%2e')
    }
    expect(rewriteReadmeUrl('%2e%2e/%2e%2e/x', 'image', mono)).toBe('https://raw.githubusercontent.com/acme/plugins/main/x')
  })
  it('opens protocol-relative links in a new tab', () => {
    expect(render('[x](//example.com/a)')).toContain('target="_blank"')
  })
  it('allows GitHub workflow badges and repo assets, upgrades http', () => {
    expect(isAllowedReadmeImageUrl('https://github.com/o/r/actions/workflows/ci.yml/badge.svg?branch=main')).toBe(true)
    expect(isAllowedReadmeImageUrl('https://github.com/o/r/assets/123/abc')).toBe(true)
    expect(isAllowedReadmeImageUrl('https://github.com/o/r/actions/runs/1')).toBe(false)
    expect(render('<img src="http://img.shields.io/x.svg">')).toContain('src="https://img.shields.io/x.svg"')
  })
  it('does not emit longDesc', () => {
    expect(render('<img src="https://img.shields.io/x.svg" longdesc="https://img.shields.io/y">').toLowerCase()).not.toContain('longdesc')
  })
  it('does not leave a table inside a paragraph', () => {
    expect(render('<math><mtext><table><tr><td>x</td></tr></table></mtext></math>')).not.toMatch(/<p><table/)
  })
})
