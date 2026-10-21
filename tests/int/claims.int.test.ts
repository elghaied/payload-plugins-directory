import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import type { GitHubOwner } from '@/lib/github/client'
import { claimPlugin, isInstantClaim, type ClaimGitHub } from '@/lib/submissions/claim'
import { MESSAGES } from '@/lib/submissions/messages'
import { CLAIM_RECHECK_COOLDOWN_MS, MAX_PENDING_PER_MAINTAINER } from '@/lib/submissions/limits'
import { relationId } from '@/lib/relationId'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const m: Record<string, CurrentMaintainer> = {}
const repoGid = { org: 5001, user: 5002, official: 5003, noid: 0, flagged: 5005 }

type Fake = { [K in keyof ClaimGitHub]: ReturnType<typeof vi.fn> } & ClaimGitHub
/** A GitHub fake. `owner` is what the LIVE repository lookup reports; `members` holds logins that are public members. */
function gh(opts: {
  owner?: GitHubOwner
  repoId?: number
  repoFail?: 'unavailable' | 'not-found' | 'invalid'
  userLogin?: string
  userId?: number
  userFail?: boolean
  members?: string[]
  membershipFail?: boolean
  throws?: boolean
  userThrows?: boolean
  membershipThrows?: boolean
  memberValue?: unknown
  malformedRepo?: boolean
  malformedUser?: boolean
  onRepoLookup?: () => Promise<void>
}): Fake {
  const boom = () => {
    if (opts.throws) throw new Error('client exploded')
  }
  return {
    getRepositoryById: vi.fn(async (id: number) => {
      boom()
      await opts.onRepoLookup?.()
      if (opts.malformedRepo) return { ok: true as const } as never
      if (opts.repoFail) return { ok: false as const, reason: opts.repoFail }
      return { ok: true as const, repository: { id: opts.repoId ?? id, fullName: 'acmeorg/forms', owner: opts.owner! } }
    }),
    getUserById: vi.fn(async (id: number) => {
      if (opts.userThrows) throw new Error('user lookup exploded')
      if (opts.malformedUser) return { ok: true as const } as never
      if (opts.userFail) return { ok: false as const, reason: 'unavailable' as const }
      return { ok: true as const, user: { id: opts.userId ?? id, login: opts.userLogin ?? 'whoever', name: null, avatarUrl: null } }
    }),
    checkPublicOrgMembership: vi.fn(async (_org: string, login: string) => {
      if (opts.membershipThrows) throw new Error('membership exploded')
      if (opts.memberValue !== undefined) return { ok: true as const, member: opts.memberValue as never }
      if (opts.membershipFail) return { ok: false as const, reason: 'unavailable' as const }
      return { ok: true as const, member: (opts.members ?? []).includes(login) }
    }),
  } as Fake
}
const calls = (g: Fake) => g.getRepositoryById.mock.calls.length + g.getUserById.mock.calls.length + g.checkPublicOrgMembership.mock.calls.length

const org = (login = 'AcmeOrg'): GitHubOwner => ({ id: 777, login, type: 'Organization' })
const user = (id: number, login = 'someone'): GitHubOwner => ({ id, login, type: 'User' })

async function maintainersOf(slug: string) {
  const res = await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, where: { slug: { equals: slug } } })
  return (res.docs[0].maintainers ?? []).map(relationId)
}
const submissionsOf = (id: number) =>
  payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { submittedBy: { equals: id } } })

/** Moves an own pending claim's last check out of (or into) the cooldown window. */
async function setLastCheck(maintainerId: number, agoMs: number) {
  const subs = await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { and: [{ submittedBy: { equals: maintainerId } }, { status: { equals: 'pending' } }] } })
  for (const doc of subs.docs) {
    await payload.update({ collection: 'submissions', id: doc.id, overrideAccess: true, depth: 0, data: { lastClaimCheckAt: new Date(Date.now() - agoMs).toISOString() } })
  }
}
const PAST_COOLDOWN = CLAIM_RECHECK_COOLDOWN_MS + 60_000

async function makePlugin(slug: string, repoId: number, extra: Record<string, unknown> = {}) {
  return payload.create({
    collection: 'plugins', overrideAccess: true,
    data: { slug, name: slug, repository: repoId, url: 'https://github.com/x/y', source: 'topic', visibility: 'listed', ...extra },
  })
}

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const mkRepo = (fullName: string, owner: string, githubId?: number) =>
    payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName, owner, githubId, url: `https://github.com/${fullName}` } })
  const orgRepo = await mkRepo('AcmeOrg/forms', 'AcmeOrg', repoGid.org)
  const userRepo = await mkRepo('solo/tool', 'solo', repoGid.user)
  const officialFlag = await mkRepo('Someone/official-ish', 'Someone', repoGid.flagged)
  const officialOrg = await mkRepo('payloadcms/plugin-x', 'payloadcms', repoGid.official)
  const noId = await mkRepo('NoId/thing', 'NoId')
  for (const slug of ['org-1', 'org-2', 'org-3', 'org-4', 'org-5', 'org-6', 'org-7', 'org-8', 'org-9', 'org-10', 'org-11', 'org-12', 'org-13', 'org-14', 'org-15', 'org-16', 'org-17', 'org-18', 'org-19']) await makePlugin(slug, orgRepo.id)
  await makePlugin('limited-plugin', orgRepo.id)
  await makePlugin('solo-tool', userRepo.id)
  await makePlugin('solo-2', userRepo.id)
  await makePlugin('flagged', officialFlag.id, { isOfficial: true })
  await makePlugin('official', officialOrg.id)
  await makePlugin('no-id', noId.id)
  await makePlugin('secret', orgRepo.id, { visibility: 'hidden' })
  await makePlugin('trashed', orgRepo.id, { deletedAt: new Date().toISOString() })

  // githubId doubles as the live owner id in the fakes below.
  for (const [key, githubId, login] of [
    ['soloOwner', 4242, 'solo'],
    ['recycled', 9999, 'solo'], // same login string as the repo owner, different account
    ['orgMember', 100, 'dbstale'],
    ['stranger', 101, 'stranger'],
    ['flaky', 102, 'flaky'],
    ['capped', 103, 'capped'],
    ['other', 104, 'other'],
    ['cooldown', 105, 'cooldown'],
    ['budget', 106, 'budget'],
    ['limited', 107, 'limited'],
  ] as const) {
    const doc = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId, login } })
    m[key] = { ...doc, collection: 'maintainers' }
  }
})
afterAll(async () => resetDatabase(payload))

describe('isInstantClaim (truth table)', () => {
  const plain = { isOfficial: false, source: 'topic' } as const
  const repoOrg = { githubId: 5001, fullName: 'AcmeOrg/forms', owner: 'AcmeOrg' }
  const repoUser = { githubId: 5002, fullName: 'solo/tool', owner: 'solo' }
  const who = { githubId: 4242 }

  it('user-owned, live owner.id equals maintainer.githubId: instant', async () => {
    expect(await isInstantClaim({ github: gh({ owner: user(4242) }), maintainer: who, plugin: plain, repository: repoUser })).toBe(true)
  })
  it('user-owned, different id: queued even though login strings may match (username recycling)', async () => {
    const g = gh({ owner: user(4242, 'solo') })
    expect(await isInstantClaim({ github: g, maintainer: { githubId: 9999 }, plugin: plain, repository: repoUser })).toBe(false)
    expect(g.checkPublicOrgMembership).not.toHaveBeenCalled()
  })
  it('looks the repository up by the stored numeric id', async () => {
    const g = gh({ owner: user(4242) })
    await isInstantClaim({ github: g, maintainer: who, plugin: plain, repository: repoUser })
    expect(g.getRepositoryById).toHaveBeenCalledWith(5002)
  })
  it('org-owned, explicit public member: instant, checked with the LIVE login and LIVE org login', async () => {
    const g = gh({ owner: org('Renamed-Org'), userLogin: 'livelogin', members: ['livelogin'] })
    expect(await isInstantClaim({ github: g, maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(true)
    expect(g.getUserById).toHaveBeenCalledWith(100)
    expect(g.checkPublicOrgMembership).toHaveBeenCalledWith('Renamed-Org', 'livelogin')
  })
  it('org-owned, stale DB login is a member but the live login is not: queued', async () => {
    const g = gh({ owner: org(), userLogin: 'newlogin', members: ['dbstale'] })
    expect(await isInstantClaim({ github: g, maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
  })
  it('org-owned, not a public member (private or absent): queued', async () => {
    expect(await isInstantClaim({ github: gh({ owner: org() }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
  })
  it.each(['unavailable', 'not-found', 'invalid'] as const)('repository lookup %s: queued', async (repoFail) => {
    expect(await isInstantClaim({ github: gh({ repoFail }), maintainer: who, plugin: plain, repository: repoUser })).toBe(false)
  })
  it('repository lookup answers for a different id: queued', async () => {
    expect(await isInstantClaim({ github: gh({ owner: user(4242), repoId: 1 }), maintainer: who, plugin: plain, repository: repoUser })).toBe(false)
  })
  it('live user lookup fails, or returns another id: queued', async () => {
    expect(await isInstantClaim({ github: gh({ owner: org(), userFail: true, members: ['x'] }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
    expect(await isInstantClaim({ github: gh({ owner: org(), userId: 5, userLogin: 'x', members: ['x'] }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
  })
  it('membership check unavailable (403/429/5xx): queued', async () => {
    expect(await isInstantClaim({ github: gh({ owner: org(), userLogin: 'x', members: ['x'], membershipFail: true }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
  })
  it('a throwing client is queued and reported, never thrown', async () => {
    const onError = vi.fn()
    expect(await isInstantClaim({ github: gh({ throws: true }), maintainer: who, plugin: plain, repository: repoUser, onError })).toBe(false)
    expect(onError).toHaveBeenCalled()
  })
  it('malformed {ok:true} bodies (no repository / no user) are queued, not thrown', async () => {
    const onError = vi.fn()
    expect(await isInstantClaim({ github: gh({ malformedRepo: true }), maintainer: who, plugin: plain, repository: repoUser, onError })).toBe(false)
    expect(await isInstantClaim({ github: gh({ owner: org(), malformedUser: true }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg, onError })).toBe(false)
    expect(onError).toHaveBeenCalledTimes(2)
  })
  it('a throwing user lookup or membership check is queued', async () => {
    expect(await isInstantClaim({ github: gh({ owner: org(), userThrows: true }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
    expect(await isInstantClaim({ github: gh({ owner: org(), userLogin: 'x', membershipThrows: true }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
  })
  it('a truthy but non-true `member` is not membership', async () => {
    for (const memberValue of ['yes', 1, {}, 'true']) {
      expect(await isInstantClaim({ github: gh({ owner: org(), userLogin: 'x', memberValue }), maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
    }
  })
  it('a live User-type owner named payloadcms is never instant', async () => {
    const g = gh({ owner: { id: 4242, login: 'PayloadCMS', type: 'User' } })
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: plain, repository: repoUser })).toBe(false)
  })
  it('an unexpected owner type is queued', async () => {
    const g = gh({ owner: { id: 4242, login: 'bot', type: 'Bot' as never } })
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: plain, repository: repoUser })).toBe(false)
  })
  it('missing stored repository githubId or maintainer githubId: queued with no GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: plain, repository: { ...repoUser, githubId: null } })).toBe(false)
    expect(await isInstantClaim({ github: g, maintainer: { githubId: undefined as never }, plugin: plain, repository: repoUser })).toBe(false)
    expect(calls(g)).toBe(0)
  })
  it('official plugins (flag, source, payloadcms owner or payloadcms/ name) are never instant and make no GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: { ...plain, isOfficial: true }, repository: repoUser })).toBe(false)
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: { ...plain, source: 'official' }, repository: repoUser })).toBe(false)
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: plain, repository: { ...repoUser, owner: 'PayloadCMS' } })).toBe(false)
    expect(await isInstantClaim({ github: g, maintainer: who, plugin: plain, repository: { ...repoUser, fullName: 'payloadcms/x', owner: 'x' } })).toBe(false)
    expect(calls(g)).toBe(0)
  })
  it('a repository whose LIVE owner is payloadcms (transferred) is never instant', async () => {
    const g = gh({ owner: org('payloadcms'), userLogin: 'x', members: ['x'] })
    expect(await isInstantClaim({ github: g, maintainer: { githubId: 100 }, plugin: plain, repository: repoOrg })).toBe(false)
    expect(g.checkPublicOrgMembership).not.toHaveBeenCalled()
  })
})

describe('claimPlugin', () => {
  it('user-owned, same numeric id: claimed, approved claim recorded, maintainer added, no jobs for maintainers-only change', async () => {
    const before = (await payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })).totalDocs
    expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'solo-tool', note: ' mine ', github: gh({ owner: user(4242) }) })).toEqual({ status: 'claimed' })
    expect(await maintainersOf('solo-tool')).toEqual([m.soloOwner.id])
    const subs = await submissionsOf(m.soloOwner.id)
    expect(subs.docs[0]).toMatchObject({ type: 'claim', status: 'approved', note: 'mine' })
    const after = (await payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'revalidate' } } })).totalDocs
    expect(after).toBe(before)
  })
  it('a recycled login (same string as the owner, different numeric id) is queued, not granted', async () => {
    expect(await claimPlugin({ payload, maintainer: m.recycled, slug: 'solo-2', note: '', github: gh({ owner: user(4242, 'solo') }) })).toEqual({ status: 'queued' })
    expect(await maintainersOf('solo-2')).toEqual([])
  })
  it('org public member (checked with the live login): claimed through the approval path', async () => {
    const g = gh({ owner: org(), userLogin: 'livemember', members: ['livemember'] })
    expect(await claimPlugin({ payload, maintainer: m.orgMember, slug: 'org-1', note: '', github: g })).toEqual({ status: 'claimed' })
    expect(await maintainersOf('org-1')).toEqual([m.orgMember.id])
    expect((await submissionsOf(m.orgMember.id)).docs[0]).toMatchObject({ type: 'claim', status: 'approved' })
  })
  it('org, private or absent membership: queued with a pending claim', async () => {
    expect(await claimPlugin({ payload, maintainer: m.stranger, slug: 'org-2', note: 'I wrote it', github: gh({ owner: org() }) })).toEqual({ status: 'queued' })
    expect(await maintainersOf('org-2')).toEqual([])
    expect((await submissionsOf(m.stranger.id)).docs[0]).toMatchObject({ type: 'claim', status: 'pending', note: 'I wrote it' })
  })
  it('GitHub rate limited / unavailable at any step: queued', async () => {
    expect(await claimPlugin({ payload, maintainer: m.flaky, slug: 'org-3', note: '', github: gh({ repoFail: 'unavailable' }) })).toEqual({ status: 'queued' })
    expect(await claimPlugin({ payload, maintainer: m.flaky, slug: 'org-4', note: '', github: gh({ owner: org(), userLogin: 'flaky', members: ['flaky'], membershipFail: true }) })).toEqual({ status: 'queued' })
    const warn = vi.spyOn(payload.logger, 'warn').mockImplementation(() => undefined)
    try {
      expect(await claimPlugin({ payload, maintainer: m.flaky, slug: 'org-5', note: '', github: gh({ throws: true }) })).toEqual({ status: 'queued' })
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
    expect(await maintainersOf('org-3')).toEqual([])
    expect(await maintainersOf('org-4')).toEqual([])
    expect(await maintainersOf('org-5')).toEqual([])
  })
  it('official plugins are queued even for an apparent owner, with no GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'official', note: '', github: g })).toEqual({ status: 'queued' })
    expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'flagged', note: '', github: g })).toEqual({ status: 'queued' })
    expect(calls(g)).toBe(0)
    expect(await maintainersOf('official')).toEqual([])
  })
  it('a repository without a stored githubId is queued with no GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'no-id', note: '', github: g })).toEqual({ status: 'queued' })
    expect(calls(g)).toBe(0)
  })
  it('re-submitting an own pending claim that still cannot be verified keeps it pending, with no new row', async () => {
    await setLastCheck(m.stranger.id, PAST_COOLDOWN)
    expect(await claimPlugin({ payload, maintainer: m.stranger, slug: 'org-2', note: '', github: gh({ owner: org() }) })).toEqual({ status: 'pending' })
    expect((await submissionsOf(m.stranger.id)).docs).toHaveLength(1)
    expect(await maintainersOf('org-2')).toEqual([])
  })
  it('an existing maintainer gets "already" without any GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'solo-tool', note: '', github: g })).toEqual({ status: 'already' })
    expect(calls(g)).toBe(0)
  })
  it('hidden, trashed and unknown plugins are not found, with no GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    for (const slug of ['secret', 'trashed', 'nope']) {
      expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug, note: '', github: g })).toEqual({ status: 'not_found' })
    }
    expect(calls(g)).toBe(0)
  })
  it('enforces the pending cap BEFORE any GitHub call', async () => {
    const g = gh({ owner: org() })
    for (let i = 0; i < MAX_PENDING_PER_MAINTAINER; i++) {
      expect(await claimPlugin({ payload, maintainer: m.capped, slug: `org-${6 + i}`, note: '', github: g })).toEqual({ status: 'queued' })
    }
    const callsBefore = calls(g)
    expect(await claimPlugin({ payload, maintainer: m.capped, slug: 'org-16', note: '', github: g })).toEqual({ status: 'invalid', message: MESSAGES.tooMany })
    expect(calls(g)).toBe(callsBefore)
    expect(await maintainersOf('org-16')).toEqual([])
  })
  it('a plugin trashed between the lookup and the write is refused, not granted', async () => {
    const g = gh({
      owner: user(4242),
      onRepoLookup: async () => {
        const doc = (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, where: { slug: { equals: 'org-17' } } })).docs[0]
        await payload.update({ collection: 'plugins', id: doc.id, overrideAccess: true, data: { deletedAt: new Date().toISOString() } })
      },
    })
    const res = await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'org-17', note: '', github: g })
    // org-17's repository is AcmeOrg's (id 5001): the fake reports a user owner whose id matches soloOwner, so it is instant.
    expect(res).toEqual({ status: 'invalid', message: MESSAGES.claimPluginGone })
    const trashed = (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, trash: true, where: { slug: { equals: 'org-17' } } })).docs[0]
    expect(trashed.maintainers ?? []).toEqual([])
  })
  it('a queued claim is approved in place when a re-submit now verifies (same row, no duplicate)', async () => {
    expect(await claimPlugin({ payload, maintainer: m.other, slug: 'org-18', note: '', github: gh({ repoFail: 'unavailable' }) })).toEqual({ status: 'queued' })
    await setLastCheck(m.other.id, PAST_COOLDOWN)
    const before = (await submissionsOf(m.other.id)).docs
    expect(before).toHaveLength(1)
    const res = await claimPlugin({ payload, maintainer: m.other, slug: 'org-18', note: '', github: gh({ owner: org(), userLogin: 'o', members: ['o'] }) })
    expect(res).toEqual({ status: 'claimed' })
    const after = (await submissionsOf(m.other.id)).docs
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ id: before[0].id, status: 'approved' })
    expect(await maintainersOf('org-18')).toEqual([m.other.id])
  })
  it('the cap does not block re-checking an own pending claim', async () => {
    await setLastCheck(m.capped.id, PAST_COOLDOWN)
    const res = await claimPlugin({ payload, maintainer: m.capped, slug: 'org-6', note: '', github: gh({ owner: org(), userLogin: 'c', members: ['c'] }) })
    expect(res).toEqual({ status: 'claimed' })
    expect(await maintainersOf('org-6')).toEqual([m.capped.id])
  })
  it('inside the cooldown a re-submit is a neutral pending with no GitHub call; after it, exactly one check', async () => {
    const g = gh({ owner: org(), userLogin: 'cool', members: [] })
    // Fresh claim: creation counts as a check, so an immediate re-submit is inside the window.
    expect(await claimPlugin({ payload, maintainer: m.cooldown, slug: 'org-19', note: '', github: g })).toEqual({ status: 'queued' })
    const afterCreate = calls(g)
    expect(afterCreate).toBeGreaterThan(0)
    expect(await claimPlugin({ payload, maintainer: m.cooldown, slug: 'org-19', note: '', github: g })).toEqual({ status: 'pending' })
    expect(calls(g)).toBe(afterCreate)
    // Just inside the window still makes no call, even if ownership would now verify.
    await setLastCheck(m.cooldown.id, CLAIM_RECHECK_COOLDOWN_MS - 5_000)
    const ok = gh({ owner: org(), userLogin: 'cool', members: ['cool'] })
    expect(await claimPlugin({ payload, maintainer: m.cooldown, slug: 'org-19', note: '', github: ok })).toEqual({ status: 'pending' })
    expect(calls(ok)).toBe(0)
    // After the window: one check; a failing one stays pending and restarts the window.
    await setLastCheck(m.cooldown.id, PAST_COOLDOWN)
    expect(await claimPlugin({ payload, maintainer: m.cooldown, slug: 'org-19', note: '', github: g })).toEqual({ status: 'pending' })
    expect(calls(g)).toBeGreaterThan(afterCreate)
    const afterRecheck = calls(g)
    expect(await claimPlugin({ payload, maintainer: m.cooldown, slug: 'org-19', note: '', github: g })).toEqual({ status: 'pending' })
    expect(calls(g)).toBe(afterRecheck)
    // After the window again, a passing check approves the existing claim.
    await setLastCheck(m.cooldown.id, PAST_COOLDOWN)
    expect(await claimPlugin({ payload, maintainer: m.cooldown, slug: 'org-19', note: '', github: ok })).toEqual({ status: 'claimed' })
    expect(await maintainersOf('org-19')).toEqual([m.cooldown.id])
  })
  it('allows one re-check per 10 minutes across ALL of a maintainer\'s claims', async () => {
    const g = gh({ owner: user(1) }) // not the owner: stays queued
    expect(await claimPlugin({ payload, maintainer: m.budget, slug: 'solo-tool', note: '', github: g })).toEqual({ status: 'queued' })
    expect(await claimPlugin({ payload, maintainer: m.budget, slug: 'solo-2', note: '', github: g })).toEqual({ status: 'queued' })
    await setLastCheck(m.budget.id, PAST_COOLDOWN)
    const first = gh({ owner: user(106) })
    expect(await claimPlugin({ payload, maintainer: m.budget, slug: 'solo-tool', note: '', github: first })).toEqual({ status: 'claimed' })
    expect(calls(first)).toBeGreaterThan(0)
    // The other claim is past its own cooldown, but the maintainer's budget is spent: no GitHub call.
    const second = gh({ owner: user(106) })
    expect(await claimPlugin({ payload, maintainer: m.budget, slug: 'solo-2', note: '', github: second })).toEqual({ status: 'pending' })
    expect(calls(second)).toBe(0)
    // Once the window has passed the budget is available again.
    await setLastCheck(m.budget.id, PAST_COOLDOWN)
    expect(await claimPlugin({ payload, maintainer: m.budget, slug: 'solo-2', note: '', github: second })).toEqual({ status: 'claimed' })
    expect(calls(second)).toBeGreaterThan(0)
  })
  it('skips re-checks while the client reports the unauthenticated quota exhausted, and keeps the budget', async () => {
    expect(await claimPlugin({ payload, maintainer: m.limited, slug: 'limited-plugin', note: '', github: gh({ owner: org(), userLogin: 'limited' }) })).toEqual({ status: 'queued' })
    await setLastCheck(m.limited.id, PAST_COOLDOWN)
    const limited = Object.assign(gh({ owner: org(), userLogin: 'limited', members: ['limited'] }), { isRateLimited: () => true })
    expect(await claimPlugin({ payload, maintainer: m.limited, slug: 'limited-plugin', note: '', github: limited })).toEqual({ status: 'pending' })
    expect(calls(limited)).toBe(0)
    // The skip spent nothing: once the quota is back the check runs and approves.
    const open = Object.assign(gh({ owner: org(), userLogin: 'limited', members: ['limited'] }), { isRateLimited: () => false })
    expect(await claimPlugin({ payload, maintainer: m.limited, slug: 'limited-plugin', note: '', github: open })).toEqual({ status: 'claimed' })
    expect(calls(open)).toBeGreaterThan(0)
  })
  it('a pending claim on an official plugin is never approved by a re-submit and makes no GitHub call', async () => {
    const g = gh({ owner: user(4242) })
    await setLastCheck(m.soloOwner.id, PAST_COOLDOWN)
    expect(await claimPlugin({ payload, maintainer: m.soloOwner, slug: 'official', note: '', github: g })).toEqual({ status: 'pending' })
    expect(calls(g)).toBe(0)
    expect(await maintainersOf('official')).toEqual([])
  })
})
