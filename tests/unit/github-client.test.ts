import { describe, expect, it, vi } from 'vitest'
import { createGitHubAuthClient } from '@/lib/github/client'

const respond = (status: number, body?: unknown) =>
  vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status }))
const call = (fetch: ReturnType<typeof respond>, n = 0) => fetch.mock.calls[n] as unknown as [string, RequestInit]

describe('checkPublicOrgMembership', () => {
  it('is member on 204 and calls the public members endpoint', async () => {
    const fetch = respond(204)
    expect(await createGitHubAuthClient({ fetch, token: 't0k' }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: true, member: true })
    const [url, init] = call(fetch)
    expect(url).toBe('https://api.github.com/orgs/acme/public_members/octo')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer t0k')
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
  it('is not a member on 404 (private member, non-member, or the owner is a user)', async () => {
    expect(await createGitHubAuthClient({ fetch: respond(404) }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: true, member: false })
  })
  it('never calls GitHub with an invalid org or login', async () => {
    const fetch = respond(204)
    const client = createGitHubAuthClient({ fetch })
    expect(await client.checkPublicOrgMembership('acme/../../user', 'octo')).toEqual({ ok: false, reason: 'invalid' })
    expect(await client.checkPublicOrgMembership('acme', 'octo?x=1')).toEqual({ ok: false, reason: 'invalid' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it('sends no Authorization header without a token', async () => {
    const fetch = respond(404)
    await createGitHubAuthClient({ fetch, token: '' }).checkPublicOrgMembership('acme', 'octo')
    expect((call(fetch)[1].headers as Record<string, string>).Authorization).toBeUndefined()
  })
})

describe('checkPublicOrgMembership failures', () => {
  it('maps 403, 302 and network errors to unavailable without throwing', async () => {
    expect(await createGitHubAuthClient({ fetch: respond(204) }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: true, member: true })
    expect(await createGitHubAuthClient({ fetch: respond(404) }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: true, member: false })
    expect(await createGitHubAuthClient({ fetch: respond(403) }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: false, reason: 'unavailable' })
    const boom = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await createGitHubAuthClient({ fetch: boom }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: false, reason: 'unavailable' })
    expect(await createGitHubAuthClient({ fetch: respond(302) }).checkPublicOrgMembership('acme', 'octo')).toEqual({ ok: false, reason: 'unavailable' })
    const redirect = vi.fn(async () => {
      throw new TypeError('fetch failed', { cause: new Error('unexpected redirect') })
    })
    expect(await createGitHubAuthClient({ fetch: redirect }).getRepositoryOwner('acme/plugin')).toEqual({ ok: false, reason: 'unavailable' })
    expect(await createGitHubAuthClient({ fetch: boom }).checkPublicOrgMembership('a/b', 'octo')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('getAuthenticatedUser', () => {
  it('maps the /user body', async () => {
    const fetch = respond(200, { id: 42, login: 'octo', name: 'Octo Cat', avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4' })
    const user = await createGitHubAuthClient({ fetch }).getAuthenticatedUser('gho_abc')
    expect(user).toEqual({ id: 42, login: 'octo', name: 'Octo Cat', avatarUrl: 'https://avatars.githubusercontent.com/u/42?v=4' })
    const [url, init] = call(fetch)
    expect(url).toBe('https://api.github.com/user')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gho_abc')
    expect(init.redirect).toBe('error')
  })
  it('drops avatar URLs that are not GitHub-hosted https', async () => {
    const fetch = respond(200, { id: 42, login: 'octo', name: null, avatar_url: 'javascript:alert(1)' })
    expect((await createGitHubAuthClient({ fetch }).getAuthenticatedUser('t')).avatarUrl).toBeNull()
    const lookalike = respond(200, { id: 42, login: 'octo', name: null, avatar_url: 'https://evilgithubusercontent.com/x' })
    expect((await createGitHubAuthClient({ fetch: lookalike }).getAuthenticatedUser('t')).avatarUrl).toBeNull()
  })
  it('clamps the name by characters without splitting an emoji at the boundary', async () => {
    const name = `${'a'.repeat(199)}\u{1F600}tail`
    const fetch = respond(200, { id: 42, login: 'octo', name })
    const got = (await createGitHubAuthClient({ fetch }).getAuthenticatedUser('t')).name!
    expect(got).toBe('a'.repeat(199)) // the pair would straddle 200 UTF-16 units, so it is dropped whole
    expect(got).not.toMatch(/[\ud800-\udbff]$/)
  })
  it('throws on a non-200 or malformed body', async () => {
    await expect(createGitHubAuthClient({ fetch: respond(401) }).getAuthenticatedUser('t')).rejects.toThrow()
    await expect(createGitHubAuthClient({ fetch: respond(200, { id: '42', login: 'octo' }) }).getAuthenticatedUser('t')).rejects.toThrow()
  })
})

describe('getRepositoryOwner (live owner lookup)', () => {
  const body = { id: 1, full_name: 'acme/plugin', owner: { id: 7, login: 'Acme', type: 'Organization' } }
  it('looks up by numeric id', async () => {
    const fetch = respond(200, body)
    expect(await createGitHubAuthClient({ fetch, token: 't' }).getRepositoryOwner(1)).toEqual({
      ok: true,
      owner: { id: 7, login: 'Acme', type: 'Organization' },
    })
    expect(call(fetch)[0]).toBe('https://api.github.com/repositories/1')
  })
  it('looks up by full name', async () => {
    const fetch = respond(200, body)
    await createGitHubAuthClient({ fetch }).getRepositoryOwner('Acme/Plugin')
    expect(call(fetch)[0]).toBe('https://api.github.com/repos/acme/plugin')
  })
  it('returns typed failures instead of throwing', async () => {
    expect(await createGitHubAuthClient({ fetch: respond(404) }).getRepositoryOwner('acme/plugin')).toEqual({ ok: false, reason: 'not-found' })
    expect(await createGitHubAuthClient({ fetch: respond(500) }).getRepositoryOwner('acme/plugin')).toEqual({ ok: false, reason: 'unavailable' })
    expect(await createGitHubAuthClient({ fetch: respond(200, { owner: { id: 'x' } }) }).getRepositoryOwner(1)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await createGitHubAuthClient({ fetch: respond(200, { owner: { id: 1, login: 'a', type: 'Bot' } }) }).getRepositoryOwner(1)).toEqual({ ok: false, reason: 'unavailable' })
    const boom = vi.fn(async () => {
      throw new Error('network')
    })
    expect(await createGitHubAuthClient({ fetch: boom }).getRepositoryOwner(1)).toEqual({ ok: false, reason: 'unavailable' })
  })
  it('never calls GitHub with an invalid reference', async () => {
    const fetch = respond(200, body)
    const client = createGitHubAuthClient({ fetch })
    expect(await client.getRepositoryOwner('acme/../x')).toEqual({ ok: false, reason: 'invalid' })
    expect(await client.getRepositoryOwner('acme')).toEqual({ ok: false, reason: 'invalid' })
    expect(await client.getRepositoryOwner(-1)).toEqual({ ok: false, reason: 'invalid' })
    expect(await client.getRepositoryOwner(1.5)).toEqual({ ok: false, reason: 'invalid' })
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('getUserById (current login for a numeric GitHub id)', () => {
  it('maps the body and fails softly', async () => {
    const fetch = respond(200, { id: 42, login: 'octo', name: null, avatar_url: null })
    expect(await createGitHubAuthClient({ fetch }).getUserById(42)).toEqual({
      ok: true,
      user: { id: 42, login: 'octo', name: null, avatarUrl: null },
    })
    expect(call(fetch)[0]).toBe('https://api.github.com/user/42')
    expect(await createGitHubAuthClient({ fetch: respond(404) }).getUserById(42)).toEqual({ ok: false, reason: 'not-found' })
    expect(await createGitHubAuthClient({ fetch: respond(502) }).getUserById(42)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await createGitHubAuthClient({ fetch }).getUserById(0)).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('getRepositoryById', () => {
  const body = { id: 9, full_name: 'Acme/Plugin', owner: { id: 7, login: 'Acme', type: 'Organization' } }
  it('looks up /repositories/{id} and maps the body', async () => {
    const fetch = respond(200, body)
    expect(await createGitHubAuthClient({ fetch }).getRepositoryById(9)).toEqual({
      ok: true,
      repository: { id: 9, fullName: 'acme/plugin', owner: { id: 7, login: 'Acme', type: 'Organization' } },
    })
    const [url, init] = call(fetch)
    expect(url).toBe('https://api.github.com/repositories/9')
    expect(init.redirect).toBe('error')
  })
  it('returns typed failures instead of throwing', async () => {
    expect(await createGitHubAuthClient({ fetch: respond(404) }).getRepositoryById(9)).toEqual({ ok: false, reason: 'not-found' })
    expect(await createGitHubAuthClient({ fetch: respond(503) }).getRepositoryById(9)).toEqual({ ok: false, reason: 'unavailable' })
    expect(await createGitHubAuthClient({ fetch: respond(200, { id: 9, full_name: 'nope', owner: body.owner }) }).getRepositoryById(9)).toEqual({ ok: false, reason: 'unavailable' })
    const boom = vi.fn(async () => {
      throw new Error('network')
    })
    expect(await createGitHubAuthClient({ fetch: boom }).getRepositoryById(9)).toEqual({ ok: false, reason: 'unavailable' })
    const fetch = respond(200, body)
    expect(await createGitHubAuthClient({ fetch }).getRepositoryById(0)).toEqual({ ok: false, reason: 'invalid' })
    expect(fetch).not.toHaveBeenCalled()
  })
})
