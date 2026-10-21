import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { ValidationError, type Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import type { GitHubOwner } from '@/lib/github/client'
import { claimListing, claimPlugin, type ClaimGitHub } from '@/lib/submissions/claim'
import { MESSAGES } from '@/lib/submissions/messages'
import { MAX_PENDING_PER_MAINTAINER } from '@/lib/submissions/limits'
import { relationId } from '@/lib/relationId'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const m: Record<string, CurrentMaintainer> = {}

/** A GitHub fake whose live repository lookup reports `owner`. Never touches the network. */
function gh(owner: GitHubOwner): ClaimGitHub & { getRepositoryById: ReturnType<typeof vi.fn> } {
  return {
    getRepositoryById: vi.fn(async (id: number) => ({ ok: true as const, repository: { id, fullName: 'x/y', owner } })),
    getUserById: vi.fn(async (id: number) => ({ ok: true as const, user: { id, login: 'whoever', name: null, avatarUrl: null } })),
    checkPublicOrgMembership: vi.fn(async () => ({ ok: true as const, member: false })),
  } as never
}
const user = (id: number): GitHubOwner => ({ id, login: 'solo', type: 'User' })

async function makeTemplate(slug: string, repositoryId: number, extra: Record<string, unknown> = {}) {
  return payload.create({
    collection: 'templates', overrideAccess: true, context: { skipRevalidate: true },
    data: { slug, name: slug, repository: repositoryId, url: 'https://github.com/x/y', source: 'submission', visibility: 'listed', ...extra } as never,
  })
}
const maintainersOf = async (slug: string) =>
  ((await payload.find({ collection: 'templates', overrideAccess: true, depth: 0, where: { slug: { equals: slug } } })).docs[0].maintainers ?? []).map(relationId)
const submissionsOf = (id: number) =>
  payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, sort: 'createdAt', where: { submittedBy: { equals: id } } })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const mkRepo = (fullName: string, owner: string, githubId: number) =>
    payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName, owner, githubId, url: `https://github.com/${fullName}` } })
  const soloRepo = await mkRepo('solo/starter', 'solo', 7001)
  const officialRepo = await mkRepo('payloadcms/payload', 'payloadcms', 7002)
  await makeTemplate('7001-root', soloRepo.id)
  await makeTemplate('website', officialRepo.id, { isOfficial: true, source: 'official', path: 'templates/website' })
  await makeTemplate('7001-hidden', soloRepo.id, { visibility: 'hidden' })
  for (let i = 0; i < MAX_PENDING_PER_MAINTAINER + 1; i++) await makeTemplate(`cap-${i}`, soloRepo.id)
  const pluginRepo = await mkRepo('solo/plugin', 'solo', 7003)
  await payload.create({
    collection: 'plugins', overrideAccess: true,
    data: { slug: 'solo-plugin', name: 'solo-plugin', repository: pluginRepo.id, url: pluginRepo.url, source: 'topic', visibility: 'listed' },
  })
  for (const [key, githubId, login] of [['owner', 4242, 'solo'], ['stranger', 101, 'stranger'], ['capped', 103, 'capped']] as const) {
    m[key] = { ...(await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId, login } })), collection: 'maintainers' }
  }
})
afterAll(async () => resetDatabase(payload))

describe('claimListing (templates)', () => {
  it('claims instantly when the live repository owner id is the maintainer githubId', async () => {
    const g = gh(user(4242))
    expect(await claimListing({ payload, maintainer: m.owner, kind: 'template', slug: '7001-root', note: 'mine', github: g })).toEqual({ status: 'claimed' })
    expect(g.getRepositoryById).toHaveBeenCalledWith(7001)
    expect(await maintainersOf('7001-root')).toEqual([m.owner.id])
    const sub = (await submissionsOf(m.owner.id)).docs.at(-1)!
    expect(sub).toMatchObject({ type: 'claim', kind: 'template', status: 'approved' })
    expect(relationId(sub.template)).toEqual(expect.any(Number))
    expect(sub.plugin ?? null).toBeNull()
  })
  it('a second claim by the same maintainer is "already"', async () => {
    expect(await claimListing({ payload, maintainer: m.owner, kind: 'template', slug: '7001-root', note: '', github: gh(user(4242)) })).toEqual({ status: 'already' })
  })
  it('an official template is never instant: the claim is queued and no GitHub call is made', async () => {
    const g = gh(user(4242))
    expect(await claimListing({ payload, maintainer: m.owner, kind: 'template', slug: 'website', note: '', github: g })).toEqual({ status: 'queued' })
    expect(g.getRepositoryById).not.toHaveBeenCalled()
    expect(await maintainersOf('website')).toEqual([])
    const pending = (await submissionsOf(m.owner.id)).docs.filter((s) => s.status === 'pending')
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ kind: 'template', type: 'claim' })
    // Re-claiming inside the cooldown is neutral, never a duplicate row.
    expect(await claimListing({ payload, maintainer: m.owner, kind: 'template', slug: 'website', note: '', github: g })).toEqual({ status: 'pending' })
    expect((await submissionsOf(m.owner.id)).docs.filter((s) => s.status === 'pending')).toHaveLength(1)
  })
  it('approving a queued template claim adds the maintainer to the template', async () => {
    const pending = (await submissionsOf(m.owner.id)).docs.find((s) => s.status === 'pending')!
    await payload.update({ collection: 'submissions', id: pending.id, overrideAccess: true, data: { status: 'approved' } })
    expect(await maintainersOf('website')).toEqual([m.owner.id])
  })
  it('a non-owner is queued, not granted', async () => {
    expect(await claimListing({ payload, maintainer: m.stranger, kind: 'template', slug: '7001-root', note: '', github: gh(user(4242)) })).toEqual({ status: 'queued' })
    expect(await maintainersOf('7001-root')).toEqual([m.owner.id])
  })
  it('hidden or unknown templates are not_found; a plugin slug is not a template', async () => {
    for (const slug of ['7001-hidden', 'nope', 'solo-plugin']) {
      expect(await claimListing({ payload, maintainer: m.stranger, kind: 'template', slug, note: '', github: gh(user(101)) })).toEqual({ status: 'not_found' })
    }
  })
  it('pending template claims and plugin claims both count towards MAX_PENDING_PER_MAINTAINER', async () => {
    const official = gh({ id: 1, login: 'payloadcms', type: 'Organization' }) // live owner payloadcms: never instant
    expect(await claimPlugin({ payload, maintainer: m.capped, slug: 'solo-plugin', note: '', github: official })).toEqual({ status: 'queued' })
    for (let i = 0; i < MAX_PENDING_PER_MAINTAINER - 1; i++) {
      expect(await claimListing({ payload, maintainer: m.capped, kind: 'template', slug: `cap-${i}`, note: '', github: official })).toEqual({ status: 'queued' })
    }
    expect(await claimListing({ payload, maintainer: m.capped, kind: 'template', slug: `cap-${MAX_PENDING_PER_MAINTAINER}`, note: '', github: official })).toEqual({
      status: 'invalid', message: MESSAGES.tooMany,
    })
  })
  it('a maintainer cannot create a claim for a hidden template through the Local API as themselves', async () => {
    const hidden = (await payload.find({ collection: 'templates', overrideAccess: true, depth: 0, where: { slug: { equals: '7001-hidden' } } })).docs[0]
    const err = await payload
      .create({ collection: 'submissions', overrideAccess: false, user: m.stranger, data: { type: 'claim', kind: 'template', template: hidden.id } as never })
      .then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect((err as ValidationError).data.errors[0]).toMatchObject({ path: 'template', message: MESSAGES.claimTemplateNotListed })
    expect((await payload.count({ collection: 'submissions', overrideAccess: true, where: { template: { equals: hidden.id } } })).totalDocs).toBe(0)
  })
  it('claimPlugin is unchanged: a plugin claim is stored with kind plugin', async () => {
    const sub = (await submissionsOf(m.capped.id)).docs.find((s) => relationId(s.plugin) !== undefined)!
    expect(sub).toMatchObject({ kind: 'plugin', type: 'claim' })
    expect(sub.template ?? null).toBeNull()
  })
})
