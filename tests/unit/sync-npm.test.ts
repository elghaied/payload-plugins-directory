import { describe, expect, it } from 'vitest'
import { HttpError, RateLimitError } from '@/sync/http'
import { createNpmClient, InvalidNpmPackageNameError } from '@/sync/npm'
import { fakeFetch } from '../helpers/fakeFetch'
import { DOWNLOADS, json, npmRoutes, REGISTRY } from '../fixtures/sync/github'

const now = () => new Date('2026-10-19T12:00:00Z')

describe('createNpmClient().getPackage', () => {
  it('maps registry metadata and download counts like the legacy script', async () => {
    const f = fakeFetch(
      npmRoutes('payload-seo', {
        version: '2.1.0', weekly: 1234, monthly: 5000, deps: { a: '1', b: '2' }, size: 30_000,
        published: '2026-10-01T00:00:00.000Z', repositoryUrl: 'git+https://github.com/acme/seo.git',
      }),
    )
    expect(await createNpmClient({ fetch: f, now }).getPackage('payload-seo')).toEqual({
      data: {
        weeklyDownloads: 1234, monthlyDownloads: 5000, latestVersion: '2.1.0', unpackedSize: 30000,
        lastPublish: '2026-10-01T00:00:00.000Z', dependencyCount: 2,
      },
      repositoryUrl: 'git+https://github.com/acme/seo.git',
    })
  })

  it('encodes scoped names and counts missing (404) download stats as 0', async () => {
    const id = encodeURIComponent('@acme/seo')
    const f = fakeFetch({
      ...npmRoutes('@acme/seo'),
      [`${DOWNLOADS}/last-week/${id}`]: { status: 404 },
      [`${DOWNLOADS}/last-month/${id}`]: { status: 404 },
    })
    const info = await createNpmClient({ fetch: f, now }).getPackage('@acme/seo')
    expect(info?.data).toMatchObject({ weeklyDownloads: 0, monthlyDownloads: 0, latestVersion: '1.2.0' })
    expect(f.calls[0].url).toBe(`${REGISTRY}/%40acme%2Fseo`)
  })

  it('returns null for unknown packages and packages without a latest tag', async () => {
    const unknown = fakeFetch({ ...npmRoutes('nope'), [`${REGISTRY}/nope`]: { status: 404 } })
    expect(await createNpmClient({ fetch: unknown, now }).getPackage('nope')).toBeNull()
    const untagged = fakeFetch({ ...npmRoutes('odd'), [`${REGISTRY}/odd`]: json({ name: 'odd', 'dist-tags': {} }) })
    expect(await createNpmClient({ fetch: untagged, now }).getPackage('odd')).toBeNull()
  })

  it('throws RateLimitError on a 429 from any endpoint', async () => {
    const f = fakeFetch({ ...npmRoutes('busy'), [`${DOWNLOADS}/last-week/busy`]: { status: 429, headers: { 'retry-after': '30' } } })
    const err = await createNpmClient({ fetch: f, now }).getPackage('busy').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(RateLimitError)
    expect((err as RateLimitError).resetAt).toEqual(new Date('2026-10-19T12:00:30Z'))
  })

  it('throws HttpError when the registry fails', async () => {
    const f = fakeFetch({ ...npmRoutes('down'), [`${REGISTRY}/down`]: { status: 503 } })
    await expect(createNpmClient({ fetch: f, now }).getPackage('down')).rejects.toBeInstanceOf(HttpError)
  })

  it('falls back to a string repository field on the package root', async () => {
    const f = fakeFetch({
      ...npmRoutes('rooted'),
      [`${REGISTRY}/rooted`]: json({
        name: 'rooted', repository: 'github:acme/rooted', 'dist-tags': { latest: '1.0.0' },
        time: { '1.0.0': '2026-01-01T00:00:00.000Z' }, versions: { '1.0.0': {} },
      }),
    })
    const info = await createNpmClient({ fetch: f, now }).getPackage('rooted')
    expect(info?.repositoryUrl).toBe('github:acme/rooted')
    expect(info?.data).toMatchObject({ unpackedSize: null, dependencyCount: 0 })
  })

  it.each([
    '../x', 'a/../../b', '%2e%2e', '%2e%2e/x', 'Payload-SEO', 'has space', ' padded', '', '.hidden', '_private',
    '@scope', '@scope/', '@/x', '@a/b/c', '@a/../b', 'a/b', 'a\\b', 'a?x=1', 'a#b', 'a@b', 'a\nb', '..', '.',
    'x'.repeat(215), '\ud800',
  ])('rejects malicious name %j without any fetch', async (name) => {
    const f = fakeFetch()
    await expect(createNpmClient({ fetch: f, now }).getPackage(name)).rejects.toBeInstanceOf(InvalidNpmPackageNameError)
    expect(f.calls).toHaveLength(0)
  })

  it('accepts a 214-character name', async () => {
    const name = 'x'.repeat(214)
    const f = fakeFetch(npmRoutes(name))
    expect((await createNpmClient({ fetch: f, now }).getPackage(name))?.data.latestVersion).toBe('1.2.0')
  })

  it('only talks to the npm hosts', async () => {
    const f = fakeFetch(npmRoutes('@acme/seo'))
    await createNpmClient({ fetch: f, now }).getPackage('@acme/seo')
    for (const c of f.calls) expect(['https://registry.npmjs.org', 'https://api.npmjs.org']).toContain(new URL(c.url).origin)
  })

  it('throws instead of recording 0 downloads on a 5xx from the downloads API', async () => {
    const f = fakeFetch({ ...npmRoutes('flaky'), [`${DOWNLOADS}/last-month/flaky`]: { status: 500 } })
    await expect(createNpmClient({ fetch: f, now }).getPackage('flaky')).rejects.toBeInstanceOf(HttpError)
  })

  it('propagates network errors from the downloads API', async () => {
    const routes = npmRoutes('net')
    routes[`${DOWNLOADS}/last-week/net`] = () => { throw new Error('socket hang up') }
    await expect(createNpmClient({ fetch: fakeFetch(routes), now }).getPackage('net')).rejects.toThrow('socket hang up')
  })

  it('counts an unparseable downloads body as 0', async () => {
    const f = fakeFetch({ ...npmRoutes('odd2'), [`${DOWNLOADS}/last-week/odd2`]: { text: 'not json' } })
    expect((await createNpmClient({ fetch: f, now }).getPackage('odd2'))?.data.weeklyDownloads).toBe(0)
  })

  it('throws RateLimitError on a 429 from the registry', async () => {
    const f = fakeFetch({ ...npmRoutes('busy2'), [`${REGISTRY}/busy2`]: { status: 429, headers: { 'retry-after': '30' } } })
    await expect(createNpmClient({ fetch: f, now }).getPackage('busy2')).rejects.toBeInstanceOf(RateLimitError)
  })

  it.each(['@payloadcms/plugin-seo', 'payload-plugin-x.y', '@payload-enchants/translator', 'payload-auth', '@a/b'])(
    'accepts real package name %s',
    async (name) => {
      const f = fakeFetch(npmRoutes(name))
      expect((await createNpmClient({ fetch: f, now }).getPackage(name))?.data.latestVersion).toBe('1.2.0')
    },
  )
})
