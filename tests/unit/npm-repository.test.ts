import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'
import { createNpmRepositoryResolver, githubFullNameFromRepositoryField } from '@/lib/npm/repository'

describe('githubFullNameFromRepositoryField', () => {
  it.each([
    ['git+https://github.com/Acme/Plugin.git', 'acme/plugin'],
    ['https://github.com/acme/plugin', 'acme/plugin'],
    ['git://github.com/acme/plugin.git', 'acme/plugin'],
    ['ssh://git@github.com/acme/plugin.git', 'acme/plugin'],
    ['git@github.com:acme/plugin.git', 'acme/plugin'],
    ['github:acme/plugin', 'acme/plugin'],
    ['acme/plugin', 'acme/plugin'],
    [{ type: 'git', url: 'git+https://github.com/acme/plugin.git', directory: 'packages/x' }, 'acme/plugin'],
    ['https://github.com/acme/plugin/tree/main#readme', 'acme/plugin'],
  ])('%j → %s', (field, expected) => {
    expect(githubFullNameFromRepositoryField(field)).toBe(expected)
  })
  it.each([undefined, null, 42, {}, { url: 7 }, 'gitlab:acme/plugin', 'https://gitlab.com/acme/plugin', 'https://github.com.evil.com/a/b', 'bitbucket:acme/plugin'])(
    'returns null for %j',
    (field) => {
      expect(githubFullNameFromRepositoryField(field)).toBeNull()
    },
  )
})

const doc = (repository: unknown) => ({
  'dist-tags': { latest: '1.0.0' },
  time: { '1.0.0': '2026-01-01T00:00:00.000Z' },
  versions: { '1.0.0': {} },
  repository,
})

describe('createNpmRepositoryResolver', () => {
  it('reads repository from the registry document (scoped name encoded)', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(doc({ url: 'git+https://github.com/Acme/plugin.git' }))))
    expect(await createNpmRepositoryResolver({ fetch })('@acme/plugin')).toBe('acme/plugin')
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://registry.npmjs.org/%40acme%2Fplugin')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('only requests registry.npmjs.org / api.npmjs.org', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(doc('acme/plugin'))))
    await createNpmRepositoryResolver({ fetch })('x')
    for (const [url] of fetch.mock.calls as unknown as [string][]) {
      expect(['registry.npmjs.org', 'api.npmjs.org']).toContain(new URL(url).hostname)
    }
  })
  it('returns null on 404 or a non-GitHub repository', async () => {
    expect(await createNpmRepositoryResolver({ fetch: vi.fn(async () => new Response('', { status: 404 })) })('x')).toBeNull()
    const gitlab = vi.fn(async () => new Response(JSON.stringify(doc('gitlab:acme/x'))))
    expect(await createNpmRepositoryResolver({ fetch: gitlab })('x')).toBeNull()
  })
  it('never requests an invalid package name', async () => {
    const fetch = vi.fn()
    expect(await createNpmRepositoryResolver({ fetch })('../../etc')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })
  it('throws on registry errors', async () => {
    await expect(createNpmRepositoryResolver({ fetch: vi.fn(async () => new Response('', { status: 503 })) })('x')).rejects.toThrow(/503/)
  })
})
