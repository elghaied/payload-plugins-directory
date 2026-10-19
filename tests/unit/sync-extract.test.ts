import { describe, expect, it } from 'vitest'
import { extractOfficialPlugins, extractPlugins, MAX_SUBDIRS_PER_DIR, MAX_WORKSPACE_DIRS } from '@/sync/extract'
import { createGitHubClient } from '@/sync/github'
import { HttpError } from '@/sync/http'
import { fakeFetch, type FakeRoute } from '../helpers/fakeFetch'
import { API, contents, dirEntry, ghRepo, json, pkg, RAW, raw, text } from '../fixtures/sync/github'

const gh = (routes: Record<string, FakeRoute>) =>
  createGitHubClient({ fetch: fakeFetch(routes, { notFoundPrefixes: [RAW] }), now: () => new Date('2026-10-19T12:00:00Z') })

describe('extractPlugins', () => {
  it('extracts a single-package repository with its full README', async () => {
    const repo = ghRepo(11, 'acme/payload-seo')
    const result = await extractPlugins(repo, gh({
      [raw('acme/payload-seo', 'package.json')]: pkg({ name: 'payload-seo', description: 'SEO tools', keywords: ['seo', 'payload'], peerDependencies: { payload: '^3.0.0' } }),
      [raw('acme/payload-seo', 'README.md')]: text('# SEO\n\nFull readme'),
    }))
    expect(result).toEqual({
      isMonorepo: false,
      plugins: [{
        slug: '11-root', name: 'payload seo', packageName: 'payload-seo', url: 'https://github.com/acme/payload-seo',
        description: 'SEO tools', payloadVersionRange: '^3.0.0', readme: '# SEO\n\nFull readme',
        keywords: ['seo', 'payload'], isOfficial: false,
      }],
    })
  })

  it('lists a repository without package.json with an unknown version', async () => {
    const result = await extractPlugins(ghRepo(12, 'acme/tool'), gh({}))
    expect(result.plugins).toEqual([expect.objectContaining({
      slug: '12-root', description: 'tool for Payload', payloadVersionRange: null, packageName: undefined,
    })])
  })

  it('extracts workspace packages that need payload at runtime', async () => {
    const result = await extractPlugins(ghRepo(21, 'acme/mono'), gh({
      [raw('acme/mono', 'package.json')]: pkg({ name: 'mono', private: true, workspaces: ['packages/*'] }),
      [contents('acme/mono', 'packages')]: json([
        dirEntry('seo', 'packages/seo'), dirEntry('dev', 'packages/dev'), dirEntry('ui', 'packages/ui'),
        { name: 'README.md', path: 'packages/README.md', type: 'file' },
      ]),
      [raw('acme/mono', 'packages/seo/package.json')]: pkg({ name: '@acme/payload-seo', description: 'SEO', keywords: ['seo'], peerDependencies: { payload: '^3.0.0' } }),
      [raw('acme/mono', 'packages/dev/package.json')]: pkg({ name: 'dev', dependencies: { payload: '^3.0.0' } }),
      [raw('acme/mono', 'packages/ui/package.json')]: pkg({ name: '@acme/ui', dependencies: { react: '19' } }),
      [raw('acme/mono', 'packages/seo/README.md')]: text('# SEO package'),
    }))
    expect(result).toEqual({
      isMonorepo: true,
      plugins: [{
        slug: '21-seo', name: 'seo', packageName: '@acme/payload-seo', path: 'packages/seo',
        url: 'https://github.com/acme/mono/tree/main/packages/seo', description: 'SEO', payloadVersionRange: '^3.0.0',
        readme: '# SEO package', keywords: ['seo'], isOfficial: false,
      }],
    })
  })

  it('scans packages/ under a private root without workspaces', async () => {
    const result = await extractPlugins(ghRepo(31, 'acme/pnpm-mono'), gh({
      [raw('acme/pnpm-mono', 'package.json')]: pkg({ name: 'root', private: true }),
      [contents('acme/pnpm-mono', 'packages')]: json([dirEntry('a', 'packages/a')]),
      [raw('acme/pnpm-mono', 'packages/a/package.json')]: pkg({ name: 'payload-a', peerDependencies: { payload: '^2.0.0' } }),
    }))
    expect(result.plugins.map((p) => [p.slug, p.payloadVersionRange])).toEqual([['31-a', '^2.0.0']])
    expect(result.isMonorepo).toBe(true)
  })

  it('falls back to an unknown-version root plugin when nothing mentions payload', async () => {
    const result = await extractPlugins(ghRepo(41, 'acme/tooling'), gh({
      [raw('acme/tooling', 'package.json')]: pkg({ name: 'tooling' }),
      [contents('acme/tooling', 'packages')]: { status: 404 },
    }))
    expect(result.plugins).toEqual([expect.objectContaining({ slug: '41-root', packageName: 'tooling', payloadVersionRange: null })])
  })

  it('throws on a transient raw.githubusercontent.com failure instead of treating the file as missing', async () => {
    await expect(extractPlugins(ghRepo(51, 'acme/flaky'), gh({ [raw('acme/flaky', 'package.json')]: { status: 500 } })))
      .rejects.toBeInstanceOf(HttpError)
  })

  it('skips malformed workspace entries without aborting or requesting them', async () => {
    const fetch = fakeFetch({
      [raw('acme/evil', 'package.json')]: pkg({ name: 'evil', private: true, workspaces: ['../../user', '/etc/*', 'packages/*'] }),
      [contents('acme/evil', 'packages')]: json([dirEntry('seo', 'packages/seo')]),
      [raw('acme/evil', 'packages/seo/package.json')]: pkg({ name: 'payload-seo', peerDependencies: { payload: '^3.0.0' } }),
    }, { notFoundPrefixes: [RAW] })
    const client = createGitHubClient({ fetch, now: () => new Date('2026-10-19T12:00:00Z') })
    const result = await extractPlugins(ghRepo(61, 'acme/evil'), client)
    expect(result.plugins.map((p) => p.slug)).toEqual(['61-seo'])
    const urls = [...new Set(fetch.calls.map((c) => c.url))]
    expect(urls.filter((u) => u.includes('/contents/'))).toEqual([contents('acme/evil', 'packages')])
    expect(urls.filter((u) => u.includes('/packages/') || u.endsWith('/package.json'))).toEqual([
      raw('acme/evil', 'package.json'),
      raw('acme/evil', 'packages/seo/package.json'),
      raw('acme/evil', 'packages/seo/README.md'),
      raw('acme/evil', 'packages/seo/readme.md'),
      raw('acme/evil', 'packages/seo/Readme.md'),
    ].filter((u) => urls.includes(u)))
  })

  it('caps workspace directories and subdirectories per directory', async () => {
    const dirs = Array.from({ length: 50 }, (_, i) => `d${i}`)
    const f1 = fakeFetch({
      [raw('acme/wide', 'package.json')]: pkg({ name: 'wide', workspaces: dirs.map((d) => `${d}/*`) }),
    }, { notFoundPrefixes: [RAW, `${API}/repos/acme/wide/contents/`] })
    await extractPlugins(ghRepo(71, 'acme/wide'), createGitHubClient({ fetch: f1 }))
    expect(f1.calls.filter((c) => c.url.startsWith(`${API}/repos/acme/wide/contents/d`)).length).toBeLessThanOrEqual(MAX_WORKSPACE_DIRS)

    const subs = Array.from({ length: 150 }, (_, i) => dirEntry(`p${i}`, `packages/p${i}`))
    const f2 = fakeFetch({
      [raw('acme/deep', 'package.json')]: pkg({ name: 'deep', workspaces: ['packages/*'] }),
      [contents('acme/deep', 'packages')]: json(subs),
    }, { notFoundPrefixes: [RAW] })
    await extractPlugins(ghRepo(72, 'acme/deep'), createGitHubClient({ fetch: f2 }))
    const pkgFetches = [...new Set(f2.calls.map((c) => c.url))].filter((u) => u.endsWith('/package.json') && u.includes('/packages/'))
    expect(pkgFetches.length).toBe(MAX_SUBDIRS_PER_DIR)
  })

  it('ignores non-string and non-array workspace declarations', async () => {
    for (const workspaces of [[1, 'packages/*'], { packages: 'packages/*' }]) {
      const f = fakeFetch({
        [raw('acme/odd', 'package.json')]: pkg({ name: 'odd', workspaces }),
      }, { notFoundPrefixes: [RAW, `${API}/repos/acme/odd/contents/`] })
      await extractPlugins(ghRepo(73, 'acme/odd'), createGitHubClient({ fetch: f }))
      const listings = new Set(f.calls.filter((c) => c.url.includes('/contents/')).map((c) => c.url))
      expect([...listings]).toEqual([contents('acme/odd', 'packages')])
    }
  })

  it('de-duplicates slugs and skips entries with invalid names', async () => {
    const pj = pkg({ name: 'x', peerDependencies: { payload: '^3.0.0' } })
    const result = await extractPlugins(ghRepo(74, 'acme/dup'), gh({
      [raw('acme/dup', 'package.json')]: pkg({ name: 'dup', workspaces: ['packages/*', 'plugins/*'] }),
      [contents('acme/dup', 'packages')]: json([dirEntry('seo', 'packages/seo'), dirEntry('..', 'packages/..')]),
      [contents('acme/dup', 'plugins')]: json([dirEntry('seo', 'plugins/seo')]),
      [raw('acme/dup', 'packages/seo/package.json')]: pj,
      [raw('acme/dup', 'plugins/seo/package.json')]: pj,
    }))
    expect(result.plugins.map((p) => [p.slug, p.path])).toEqual([['74-seo', 'packages/seo']])
  })

  it('skips directories whose slug would not be a valid plugin slug, without requesting them', async () => {
    const pj = pkg({ name: 'x', peerDependencies: { payload: '^3.0.0' } })
    const long = 'a'.repeat(210)
    const f = fakeFetch({
      [raw('acme/odd', 'package.json')]: pkg({ name: 'odd', workspaces: ['packages/*'] }),
      [contents('acme/odd', 'packages')]: json([
        dirEntry('seo', 'packages/seo'), dirEntry('has space', 'packages/has space'), dirEntry('plügin', 'packages/plügin'),
        dirEntry('a:b', 'packages/a:b'), dirEntry(long, `packages/${long}`),
      ]),
      [raw('acme/odd', 'packages/seo/package.json')]: pj,
    }, { notFoundPrefixes: [`${RAW}/acme/odd/main/packages/seo/`] })
    const result = await extractPlugins(ghRepo(75, 'acme/odd'), createGitHubClient({ fetch: f }))
    expect(result.plugins.map((p) => p.slug)).toEqual(['75-seo'])
    // Only the valid directory is read; the others are never requested.
    expect(f.calls.filter((c) => c.url.startsWith(`${RAW}/acme/odd/main/packages/`) && !c.url.includes('/seo/'))).toEqual([])
  })
})

describe('extractOfficialPlugins', () => {
  const payloadRepo = ghRepo(1000, 'payloadcms/payload')

  it('extracts packages/plugin-* with the legacy fallbacks', async () => {
    const result = await extractOfficialPlugins(payloadRepo, gh({
      [contents('payloadcms/payload', 'packages')]: json([
        dirEntry('plugin-seo', 'packages/plugin-seo'), dirEntry('plugin-form-builder', 'packages/plugin-form-builder'),
        dirEntry('ui', 'packages/ui'), dirEntry('next', 'packages/next'),
      ]),
      [raw('payloadcms/payload', 'packages/plugin-seo/package.json')]: pkg({ name: '@payloadcms/plugin-seo', description: 'SEO plugin', peerDependencies: { payload: 'workspace:*' } }),
      [raw('payloadcms/payload', 'packages/plugin-form-builder/package.json')]: pkg({}),
      [raw('payloadcms/payload', 'packages/plugin-seo/README.md')]: text('# SEO'),
    }))
    expect(result.isMonorepo).toBe(true)
    expect(result.plugins).toEqual([
      expect.objectContaining({
        slug: 'official-plugin-seo', name: 'seo', packageName: '@payloadcms/plugin-seo', path: 'packages/plugin-seo',
        url: 'https://github.com/payloadcms/payload/tree/main/packages/plugin-seo', description: 'SEO plugin',
        payloadVersionRange: 'workspace:*', readme: '# SEO', isOfficial: true,
      }),
      expect.objectContaining({
        slug: 'official-plugin-form-builder', name: 'form builder', packageName: '@payloadcms/plugin-form-builder',
        description: 'Official Payload CMS form builder plugin', payloadVersionRange: null, readme: undefined,
      }),
    ])
  })

  it('skips plugin directories whose slug would not be valid', async () => {
    const result = await extractOfficialPlugins(payloadRepo, gh({
      [contents('payloadcms/payload', 'packages')]: json([dirEntry('plugin-seo', 'packages/plugin-seo'), dirEntry('plugin-a b', 'packages/plugin-a b')]),
      [raw('payloadcms/payload', 'packages/plugin-seo/package.json')]: pkg({ name: '@payloadcms/plugin-seo' }),
      [raw('payloadcms/payload', 'packages/plugin-a%20b/package.json')]: pkg({ name: '@payloadcms/plugin-ab' }),
    }))
    expect(result.plugins.map((p) => p.slug)).toEqual(['official-plugin-seo'])
  })

  it('refuses an empty plugin listing rather than reporting every official plugin as removed', async () => {
    await expect(extractOfficialPlugins(payloadRepo, gh({ [contents('payloadcms/payload', 'packages')]: json([dirEntry('ui', 'packages/ui')]) })))
      .rejects.toThrow(/No packages\/plugin-\* directories/)
  })

  it('refuses when plugin directories exist but none could be extracted', async () => {
    await expect(extractOfficialPlugins(payloadRepo, gh({
      [contents('payloadcms/payload', 'packages')]: json([dirEntry('plugin-seo', 'packages/plugin-seo')]),
    }))).rejects.toThrow(/Extracted no official plugins/)
  })
})
