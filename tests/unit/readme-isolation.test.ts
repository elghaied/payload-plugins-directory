import { describe, expect, it } from 'vitest'
import { renderReadmeIsolated } from '@/lib/directory/renderReadmeIsolated'
import { readmeStamp, stampMatchesText } from '@/lib/directory/readmeStamp'
import { readmeRenderVersion, versionedPackages } from '@/lib/directory/readmeVersion'

const repo = { fullName: 'acme/plugins', defaultBranch: 'main', path: 'packages/seo' }

// Real worker threads: these tests start a worker (and tsx) per render.
describe('renderReadmeIsolated (real worker thread)', () => {
  it('reports why a README stays plain text (cap reason)', async () => {
    expect(await renderReadmeIsolated('>'.repeat(200), repo)).toEqual({ html: null, reason: 'cap:nesting' })
  }, 20_000)

  it('renders an ordinary README and rewrites URLs against the monorepo path', async () => {
    const { html } = await renderReadmeIsolated('# Title\n\n![shot](img/a.png) [guide](docs/g.md) **bold**\n\n| a | b |\n|---|---|\n| 1 | 2 |\n', repo)
    expect(html).toContain('<h2 id="user-content-title">Title</h2>')
    expect(html).toContain('https://raw.githubusercontent.com/acme/plugins/main/packages/seo/img/a.png')
    expect(html).toContain('https://github.com/acme/plugins/blob/main/packages/seo/docs/g.md')
    expect(html).toContain('<table>')
  }, 20_000)

  const probes: Record<string, string> = {
    'table padding (14 KB, formerly a heap OOM)': '|' + 'a|'.repeat(3_000) + '\n|' + '-|'.repeat(3_000) + '\n' + 'a\n'.repeat(1_500),
    'emphasis *_ x 60k (formerly 15-48 s)': '*_'.repeat(30_000),
    'nested images': '![['.repeat(10_000) + 'x' + '](u)'.repeat(10_000),
    'link and image mix': '[!['.repeat(5_000) + 'x' + '](u)](v)'.repeat(5_000),
    'div self-closing x 60k': '<div/>'.repeat(10_000),
    'blockquote ladder': '>'.repeat(100_000),
    'list ladder': Array.from({ length: 60 }, (_, i) => `${'  '.repeat(i)}- item`).join('\n'),
    // Passes the cheap caps (low delimiter density), so the parser really runs: only the worker limits protect.
    'diluted link nest': '[[[x]]](u) some filler words here '.repeat(1_800),
    'diluted emphasis': '*_ plain filler text goes here and there '.repeat(1_400),
  }
  for (const [name, source] of Object.entries(probes)) {
    it(`never crashes or stalls the caller: ${name}`, async () => {
      const start = performance.now()
      const { html, reason } = await renderReadmeIsolated(source, repo)
      expect(html === null || typeof html === 'string').toBe(true)
      if (html === null) expect(reason).toMatch(/^(cap:|timeout|size|error|oom|crash)/)
      expect(performance.now() - start).toBeLessThan(8_000) // 2 s render budget + worker start-up
    }, 20_000)
  }

  it('times out a render that exceeds its wall-clock budget and resolves null', async () => {
    const big = 'Some text with *emphasis* and [a link](x.md) and `code`.\n\n'.repeat(900)
    expect(await renderReadmeIsolated(big, repo, { timeoutMs: 1 })).toEqual({ html: null, reason: 'timeout' })
  }, 20_000)

  it('resolves null when the worker exceeds its memory limit', async () => {
    const big = 'Some text with *emphasis* and [a link](x.md) and `code`.\n\n'.repeat(900)
    const r = await renderReadmeIsolated(big, repo, { maxOldGenerationSizeMb: 8 })
    expect(r.html).toBeNull()
    expect(['oom', 'crash']).toContain(r.reason)
  }, 20_000)

  it('leaves the test process healthy afterwards', async () => {
    expect((await renderReadmeIsolated('ok', repo)).html).toContain('<p>ok</p>')
  }, 20_000)
})

describe('readmeStamp', () => {
  it('combines the pipeline version with a hash of the README text', () => {
    expect(readmeStamp('abc', 'text')).toMatch(/^abc\.[0-9a-f]{12}$/)
    expect(readmeStamp('abc', 'text')).not.toBe(readmeStamp('abc', 'text!'))
    expect(readmeStamp('abc', null)).toBe(readmeStamp('abc', ''))
    expect(stampMatchesText(readmeStamp('old-version', 'text'), 'text')).toBe(true)
    expect(stampMatchesText(readmeStamp('old-version', 'text'), 'edited')).toBe(false)
    expect(stampMatchesText(null, 'text')).toBe(false)
  })
})

describe('readmeRenderVersion', () => {
  it('covers the limits file and the installed versions of the whole parsing dependency closure (M6)', () => {
    const packages = versionedPackages()
    for (const name of ['unified', 'remark-parse', 'remark-gfm', 'remark-rehype', 'rehype-raw', 'rehype-sanitize', 'hast-util-to-html', 'hast-util-sanitize', 'mdast-util-to-hast', 'micromark', 'parse5', 'hast-util-raw']) {
      expect(packages.some((p) => p.startsWith(`${name}@`)), name).toBe(true)
    }
    expect(packages.every((p) => /^.+@\d+\.\d+/.test(p))).toBe(true)
  })
  it('is a stable 16-hex-character hash of the pipeline sources and pinned dependencies', () => {
    expect(readmeRenderVersion()).toMatch(/^[0-9a-f]{16}$/)
    expect(readmeRenderVersion()).toBe(readmeRenderVersion())
  })
})
