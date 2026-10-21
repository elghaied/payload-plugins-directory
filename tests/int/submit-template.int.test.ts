import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { relationId } from '@/lib/relationId'
import { MESSAGES } from '@/lib/submissions/messages'
import { submitListing } from '@/lib/submissions/submit'
import { approvedTemplateSubmissionInputs, linkApprovedTemplateSubmissions, runDiscoverTemplates } from '@/sync/templates/syncTemplate'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
let alice: CurrentMaintainer
let bob: CurrentMaintainer

const repo = (fullName: string) =>
  payload.create({
    collection: 'repositories', overrideAccess: true,
    data: { fullName, owner: fullName.split('/')[0], url: `https://github.com/${fullName}` },
  })
const template = (slug: string, repositoryId: number, path: string | null, visibility: 'listed' | 'hidden' = 'listed') =>
  payload.create({
    collection: 'templates', overrideAccess: true, depth: 0,
    data: { slug, name: `T ${slug}`, repository: repositoryId, path, url: 'https://github.com/x/y', source: 'submission', visibility },
  })
const restCreate = (user: CurrentMaintainer, data: Record<string, unknown>) =>
  payload.create({ collection: 'submissions', overrideAccess: false, user, depth: 0, data: { type: 'listing', submittedBy: user.id, status: 'pending', ...data } as never })

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const ab = await repo('A/B')
  await payload.create({
    collection: 'plugins', overrideAccess: true,
    data: { slug: 'a-b', name: 'AB Plugin', repository: ab.id, url: ab.url, source: 'topic', visibility: 'listed' },
  })
  const host = await repo('tpl/host')
  await template('1-root', host.id, null)
  await template('1-site', host.id, 'apps/site')
  const hidden = await repo('tpl/hidden')
  await template('2-root', hidden.id, null, 'hidden')
  const a = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'alice' } })
  const b = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 2, login: 'bob' } })
  alice = { ...a, collection: 'maintainers' }
  bob = { ...b, collection: 'maintainers' }
})
afterAll(async () => resetDatabase(payload))

describe('submitting a template', () => {
  it('creates a pending template listing with the canonical URL and the path', async () => {
    const r = await submitListing({ payload, maintainer: alice, url: 'https://github.com/Alice/Mono/tree/main/templates/blog', note: '', kind: 'template' })
    expect(r).toEqual({ status: 'created' })
    const doc = (await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { kind: { equals: 'template' } } })).docs[0]
    expect(doc).toMatchObject({ type: 'listing', kind: 'template', url: 'https://github.com/alice/mono/tree/HEAD/templates/blog', path: 'templates/blog', status: 'pending' })
  })
  it('a template of a repository listed as a plugin returns otherType / plugin', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/a/b', note: '', kind: 'template' })).toEqual({
      status: 'otherType', existingType: 'plugin', slug: 'a-b', name: 'AB Plugin',
    })
  })
  it('the REST-equivalent create as a maintainer is rejected by the hook with the same message', async () => {
    const err = await restCreate(bob, { kind: 'template', url: 'https://github.com/a/b' }).catch((e) => e)
    expect(JSON.stringify(err.data)).toContain(JSON.stringify(MESSAGES.otherType('plugin', 'AB Plugin')).slice(1, -1))
  })
  it('a plugin of a repository listed as a root template returns otherType / template', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/tpl/host', note: '' })).toEqual({
      status: 'otherType', existingType: 'template', slug: '1-root', name: 'T 1-root',
    })
    const err = await restCreate(bob, { url: 'https://github.com/tpl/host' }).catch((e) => e)
    expect(JSON.stringify(err.data)).toContain('A repository can be listed as a plugin or a template, not both.')
  })
  it('duplicates of the same kind are checked against templates', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/tpl/host/tree/dev/apps/site', note: '', kind: 'template' })).toEqual({
      status: 'listed', slug: '1-site', name: 'T 1-site', kind: 'template',
    })
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/tpl/hidden', note: '', kind: 'template' })).toEqual({ status: 'unavailable' })
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/alice/mono/tree/x/templates/blog', note: '', kind: 'template' })).toEqual({
      status: 'pending', kind: 'template',
    })
    // A different folder of the same repository is a different listing.
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/tpl/host/tree/main/apps/other', note: '', kind: 'template' })).toEqual({ status: 'created' })
    // A pending template does not make a plugin submission of the same repository a duplicate (and vice versa).
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/alice/mono', note: '' })).toEqual({ status: 'created' })
  })
  it('the hook enforces the template rules itself: GitHub only, path from the URL, admin-only fields stripped', async () => {
    const npm = await restCreate(bob, { kind: 'template', url: 'https://www.npmjs.com/package/some-template' }).catch((e) => e)
    expect(JSON.stringify(npm.data)).toContain(MESSAGES.templateNeedsGitHub)
    expect(await submitListing({ payload, maintainer: bob, url: 'https://www.npmjs.com/package/some-template', note: '', kind: 'template' })).toEqual({
      status: 'invalid', message: MESSAGES.templateNeedsGitHub,
    })
    await expect(restCreate(bob, { kind: 'template', url: 'https://github.com/a/c/tree/main/../x' })).rejects.toThrow()
    const stored = await restCreate(bob, { kind: 'template', url: 'https://github.com/bob/tpl/tree/main/site', path: '../../evil', template: 1 })
    expect(stored).toMatchObject({ kind: 'template', path: 'site', url: 'https://github.com/bob/tpl/tree/HEAD/site' })
    expect(stored.template ?? null).toBeNull()
    // A plugin listing never keeps a path.
    const plugin = await restCreate(bob, { url: 'https://github.com/bob/plug', path: 'x' })
    expect(plugin).toMatchObject({ kind: 'plugin' })
    expect(plugin.path ?? null).toBeNull()
  })
  it('a maintainer cannot update kind or path afterwards', async () => {
    const s = await restCreate(alice, { kind: 'template', url: 'https://github.com/alice/later' })
    await expect(
      payload.update({ collection: 'submissions', id: s.id, overrideAccess: false, user: alice, data: { kind: 'plugin', path: 'x' } }),
    ).rejects.toThrow()
  })
})

describe('template submissions feed template sync', () => {
  it('approved template submissions without a template become sync inputs; malformed rows are skipped', async () => {
    const s = await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'listing', kind: 'template', url: 'https://github.com/feed/mono/tree/HEAD/apps/web', path: 'apps/web', submittedBy: alice.id, status: 'approved' },
    })
    expect(s.repositoryFullName).toBe('feed/mono')
    await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'listing', kind: 'template', url: 'https://github.com/feed/root', submittedBy: alice.id, status: 'approved' },
    })
    // Malformed: a path that fails validation (written directly in the DB, bypassing the hooks).
    const bad = await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'listing', kind: 'template', url: 'https://github.com/feed/bad', submittedBy: alice.id, status: 'approved' },
    })
    await payload.db.drizzle.execute(sql`update submissions set path = '../etc' where id = ${bad.id}`)
    // A plugin listing is never a template input.
    await payload.create({
      collection: 'submissions', overrideAccess: true, depth: 0,
      data: { type: 'listing', url: 'https://github.com/feed/plugin', submittedBy: alice.id, status: 'approved' },
    })
    const inputs = await approvedTemplateSubmissionInputs(payload)
    expect(inputs).toEqual([
      { fullName: 'feed/mono', path: 'apps/web', source: 'submission' },
      { fullName: 'feed/root', path: null, source: 'submission' },
    ])
    const discovered = await runDiscoverTemplates(payload)
    expect(discovered).toEqual(expect.arrayContaining(inputs))
  })
  it('linkApprovedTemplateSubmissions links the matching repository + path only', async () => {
    const r = await repo('Feed/Mono')
    const t = await template('3-web', r.id, 'apps/web')
    await linkApprovedTemplateSubmissions(payload, { id: t.id, repositoryFullName: 'Feed/Mono', path: 'apps/web' })
    const subs = await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { repositoryFullName: { like: 'feed/' } }, sort: 'id' })
    const byUrl = new Map(subs.docs.map((d) => [d.url, relationId(d.template) ?? null]))
    expect(byUrl.get('https://github.com/feed/mono/tree/HEAD/apps/web')).toBe(t.id)
    expect(byUrl.get('https://github.com/feed/root')).toBeNull()
    expect((await approvedTemplateSubmissionInputs(payload)).map((i) => i.fullName)).toEqual(['feed/root'])
  })
  it('a plugin created for the repository does not link an approved template submission', async () => {
    const r = await repo('feed/root')
    await payload.create({
      collection: 'plugins', overrideAccess: true,
      data: { slug: 'feed-root', name: 'Feed Root', repository: r.id, url: r.url, source: 'submission', visibility: 'listed' },
    })
    const sub = (await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { url: { equals: 'https://github.com/feed/root' } } })).docs[0]
    expect(sub.plugin ?? null).toBeNull()
  })
})

describe('the kind column', () => {
  it('existing rows (inserted without kind) read back as plugin', async () => {
    const res = await payload.db.drizzle.execute(
      sql`insert into submissions (type, url, submitted_by_id, status, updated_at, created_at) values ('listing', 'https://github.com/legacy/row', ${alice.id}, 'pending', now(), now()) returning id`,
    )
    const id = (res.rows[0] as { id: number }).id
    const doc = await payload.findByID({ collection: 'submissions', id, overrideAccess: true, depth: 0 })
    expect(doc.kind).toBe('plugin')
  })
})
