import { describe, expect, it } from 'vitest'
import { maxTreeDepth } from '@/lib/directory/markdown'
import { README_MARKDOWN_MAX } from '@/lib/directory/readmeLimits'
import { isPathologicallyNested, readmeRenderBlocker, renderReadmeHtml, renderReadmeDetailed } from '@/lib/directory/readmeHtml'
import { ALLOWED_README_IMAGE_HOSTS, isAllowedReadmeImageUrl, rewriteReadmeUrl } from '@/lib/directory/markdown'

const repo = { fullName: 'acme/plugins', defaultBranch: 'main' }
const mono = { fullName: 'acme/plugins', defaultBranch: 'main', path: 'packages/seo' }

/** The stored HTML; '' when the README stays plain text (null). */
const render = (source: string, r = repo) => renderReadmeHtml(source, r) ?? ''

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
    expect(html).toContain('<br>')
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
    expect(html.match(/referrerpolicy="no-referrer"/gi)?.length).toBe(2)
  })
  it('filters bad srcset candidates and keeps the good one, with no-referrer on img and source', () => {
    const html = render('<picture><source srcset="https://evil.example/a.png 1x, https://camo.githubusercontent.com/b.png 2x"><img src="https://img.shields.io/x.svg"></picture>')
    expect(html).not.toContain('evil.example')
    expect(html).toContain('srcset="https://camo.githubusercontent.com/b.png 2x"')
    expect(html.match(/referrerpolicy="no-referrer"/gi)?.length).toBe(2)
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

describe('pre-parse caps (the parsers never see these)', () => {
  const blocked: Record<string, [string, string]> = {
    'blockquote x 100k': ['>'.repeat(100_000) + ' x', 'nesting'],
    'nested list markers': ['- '.repeat(2_000) + 'x', 'nesting'],
    'div x 2000': ['<div>'.repeat(2_000), 'nesting'],
    'div/ self-closing x 12k (N3)': ['<div/>'.repeat(10_000), 'nesting'],
    'unmatched end tags never close': ['<div></x>'.repeat(6_000), 'nesting'],
    'ordered list markers': ['1. '.repeat(500) + 'x', 'nesting'],
    'indented list ladder': [Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i)}- item`).join('\n'), 'nesting'],
    'table padding (3000 cols x 1500 rows)': ['|' + 'a|'.repeat(3_000) + '\n|' + '-|'.repeat(3_000) + '\n' + 'a\n'.repeat(1_500), 'table'],
    'emphasis *_ x 60k': ['*_'.repeat(30_000), 'delimiters'],
    'nested links [[[x]]](u)': ['[[[x]]](u)'.repeat(6_000), 'delimiters'],
    'nested images': ['![a'.repeat(20_000), 'delimiters'],
  }
  for (const [name, [source, why]] of Object.entries(blocked)) {
    it(`is refused quickly (${why}): ${name}`, () => {
      const start = performance.now()
      expect(readmeRenderBlocker(source)).toBe(why)
      expect(renderReadmeHtml(source, repo)).toBeNull()
      expect(performance.now() - start).toBeLessThan(500)
    })
  }
  it('flags depth only above the limit', () => {
    expect(isPathologicallyNested('> '.repeat(20) + 'x')).toBe(false)
    expect(isPathologicallyNested('> '.repeat(21) + 'x')).toBe(true)
    expect(isPathologicallyNested('<div>'.repeat(20))).toBe(false)
    expect(isPathologicallyNested('<div>'.repeat(21))).toBe(true)
    expect(isPathologicallyNested('<div><br><img src=x><p>a</p></div>'.repeat(500))).toBe(false)
    expect(isPathologicallyNested('<div></div>'.repeat(5_000))).toBe(false)
  })
  it('renders ordinary READMEs: nested lists, quotes, tables, details', () => {
    const html = render('- a\n  - b\n    - c\n\n> quote\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<details><summary>s</summary><div><p>x</p></div></details>')
    expect(html).toContain('<table>')
    expect(html).toContain('<details>')
  })
  it('caps the rendered input at README_MARKDOWN_MAX', () => {
    const html = render('a'.repeat(README_MARKDOWN_MAX + 500))
    expect(html.match(/a/g)!.length).toBeLessThan(README_MARKDOWN_MAX + 200)
  })
  it('returns null instead of throwing on bad input', () => {
    expect(renderReadmeHtml('x', { fullName: undefined as never })).toBeTypeOf('string')
    expect(() => renderReadmeHtml(undefined as never, repo)).not.toThrow()
  })
  it('drops output above the storage limit', () => {
    // 59k of dense but legal Markdown: many short links expand well beyond the 400k limit when serialised
    const source = Array.from({ length: 9_000 }, (_, i) => `[a${i}](https://example.com/${i})`).join(' ')
    const html = renderReadmeHtml(source, repo)
    expect(html === null || html.length <= 400_000).toBe(true)
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

describe('cap corrections (review M2, M3, M4, M13)', () => {
  it('M2: TypeScript generics and JSX in code fences and inline code are not tags', () => {
    const fenced = '```tsx\n' + '<Foo><Bar><Baz>'.repeat(10) + '\n```\n'
    const inline = 'Use `' + '<T>'.repeat(30) + '` and ``<a><b>`` here.\n'
    const tilde = '~~~\n' + '<div>'.repeat(30) + '\n~~~\n'
    for (const source of [fenced, inline, tilde]) {
      expect(isPathologicallyNested(source)).toBe(false)
      expect(readmeRenderBlocker(source)).toBeNull()
    }
    expect(renderReadmeHtml(fenced, repo)).not.toBeNull()
  })
  it('M2: real raw HTML outside code still counts, whatever the tag name', () => {
    expect(isPathologicallyNested('<div>'.repeat(25))).toBe(true)
    expect(isPathologicallyNested('<t>'.repeat(25))).toBe(true)
    expect(isPathologicallyNested('<t>'.repeat(10) + '<config>'.repeat(10))).toBe(false)
    expect(isPathologicallyNested('```\nx\n```\n' + '<div>'.repeat(25))).toBe(true)
  })
  it('M3: indentation after a quote marker counts as nesting', () => {
    expect(isPathologicallyNested('>\t\t\t\t\t\t\t\t\t\t\t- a')).toBe(true)
    expect(isPathologicallyNested('>' + ' '.repeat(60) + '- a')).toBe(true)
    expect(isPathologicallyNested('> - a\n> - b')).toBe(false)
  })
  it('M4: a table inside a blockquote is capped like any other', () => {
    const source = '> |' + 'a|'.repeat(3_000) + '\n> |' + '-|'.repeat(3_000) + '\n' + '> a\n'.repeat(1_500)
    expect(readmeRenderBlocker(source)).toBe('table')
  })
  it('M13: deeply nested emphasis is refused at render time, ordinary emphasis is not', () => {
    expect(readmeRenderBlocker('*a '.repeat(2_000) + 'word '.repeat(5_000))).toBe('emphasis')
    expect(readmeRenderBlocker('_a '.repeat(500) + 'word '.repeat(5_000))).toBe('emphasis')
    expect(readmeRenderBlocker('Some *emphasis* and **strong** and _under_ with snake_case_name and `*code*`.\n'.repeat(200))).toBeNull()
    expect(renderReadmeDetailed('*a '.repeat(2_000) + 'word '.repeat(5_000), repo)).toEqual({ html: null, reason: 'cap:emphasis' })
  })
  it('M9: the fallback reason is reported', () => {
    expect(renderReadmeDetailed('>'.repeat(100), repo)).toEqual({ html: null, reason: 'cap:nesting' })
    expect(renderReadmeDetailed('| a |\n|-|\n'.repeat(1) + 'x', repo).reason).toBeUndefined()
    expect(renderReadmeDetailed('# ok', repo).html).toContain('<h2')
  })
})

describe('structural depth check (authoritative, after sanitize)', () => {
  it('refuses nesting the pre-parse scan cannot see: tags hidden after fake inline code', () => {
    // The backtick inside the tag attribute is not a code span for Markdown, but withoutCode() pairs it with the next
    // one and hides everything between: the old scan sees no nesting, the final tree is 100 levels deep.
    const source = '<a title="`">' + '<div>'.repeat(100) + '<a title="`">x'
    expect(isPathologicallyNested(source)).toBe(false)
    expect(readmeRenderBlocker(source)).toBeNull()
    expect(renderReadmeDetailed(source, repo)).toEqual({ html: null, reason: 'cap:depth' })
  })
  it('refuses the same with escaped backticks and blank-line tricks', () => {
    const source = '`\\`\n\n' + '<section>'.repeat(90) + '\n\n`'
    expect(renderReadmeDetailed(source, repo).html === null || maxDepthOf(renderReadmeDetailed(source, repo).html as string) <= 64).toBe(true)
  })
  it('unknown tags wrapping known ones are caught (counted by the scan, whatever their name)', () => {
    const source = '<x>'.repeat(30) + '<div>'.repeat(30) + 'text'
    expect(renderReadmeDetailed(source, repo).html).toBeNull()
  })
  it('stores nothing deeper than the limit, accepts the limit itself', () => {
    const ok = '<div>'.repeat(19) + 'x'
    expect(renderReadmeDetailed(ok, repo).html).not.toBeNull()
    for (const n of [65, 200]) {
      const html = renderReadmeDetailed('<a title="`">' + '<span>'.repeat(n) + '<a title="`">', repo)
      expect(html.html).toBeNull()
    }
  })
  it('maxTreeDepth is iterative: a 100k-deep tree does not overflow the stack', () => {
    type Node = { type: string; tagName?: string; properties?: object; children: Node[] }
    const root: Node = { type: 'root', children: [] }
    let cur = root
    for (let i = 0; i < 100_000; i++) {
      const el: Node = { type: 'element', tagName: 'div', properties: {}, children: [] }
      cur.children.push(el)
      cur = el
    }
    expect(maxTreeDepth(root as never)).toBe(100_000)
    expect(maxTreeDepth(root as never, 64)).toBeGreaterThan(64)
  })
})

function maxDepthOf(html: string): number {
  let d = 0
  let max = 0
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)[^>]*>/g)) {
    if (['br', 'img', 'hr', 'input', 'source'].includes(m[2])) continue
    d += m[1] ? -1 : 1
    max = Math.max(max, d)
  }
  return max
}
