import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { submitListing } from '@/lib/submissions/submit'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
let alice: CurrentMaintainer
let bob: CurrentMaintainer

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = await payload.create({
    collection: 'repositories', overrideAccess: true,
    data: { fullName: 'Acme/Forms', owner: 'Acme', url: 'https://github.com/Acme/Forms' },
  })
  const hiddenRepo = await payload.create({
    collection: 'repositories', overrideAccess: true,
    data: { fullName: 'spam/blocked', owner: 'spam', url: 'https://github.com/spam/blocked' },
  })
  await payload.create({
    collection: 'plugins', overrideAccess: true,
    data: { slug: 'acme-forms', name: 'Acme Forms', packageName: '@acme/forms', repository: repo.id, url: repo.url, source: 'topic', visibility: 'listed' },
  })
  await payload.create({
    collection: 'plugins', overrideAccess: true,
    data: { slug: 'blocked', name: 'Blocked', repository: hiddenRepo.id, url: hiddenRepo.url, source: 'topic', visibility: 'hidden' },
  })
  const a = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'alice' } })
  const b = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 2, login: 'bob' } })
  alice = { ...a, collection: 'maintainers' }
  bob = { ...b, collection: 'maintainers' }
})
afterAll(async () => resetDatabase(payload))

describe('submitListing', () => {
  it('creates a pending listing with the canonical URL and the note', async () => {
    const result = await submitListing({ payload, maintainer: alice, url: 'github.com/Alice/New-Plugin/', note: '  Great plugin  ' })
    expect(result).toEqual({ status: 'created' })
    const stored = await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0 })
    expect(stored.docs[0]).toMatchObject({ type: 'listing', url: 'https://github.com/alice/new-plugin', status: 'pending', note: 'Great plugin', submittedBy: alice.id })
  })
  it('reports an already-listed repository (case-insensitive) with its slug', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/acme/forms', note: '' })).toEqual({
      status: 'listed', slug: 'acme-forms', name: 'Acme Forms',
    })
  })
  it('reports an already-listed npm package', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://www.npmjs.com/package/@acme/forms', note: '' })).toMatchObject({ status: 'listed', slug: 'acme-forms' })
  })
  it('does not reveal hidden plugins', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/spam/blocked', note: '' })).toEqual({ status: 'unavailable' })
  })
  it('reports a pending duplicate from another maintainer', async () => {
    expect(await submitListing({ payload, maintainer: bob, url: 'https://github.com/alice/new-plugin', note: '' })).toEqual({ status: 'pending' })
  })
  it('rejects non-GitHub/npm URLs without creating anything', async () => {
    const before = await payload.count({ collection: 'submissions', overrideAccess: true })
    expect(await submitListing({ payload, maintainer: bob, url: 'http://169.254.169.254/latest/meta-data', note: '' })).toMatchObject({ status: 'invalid' })
    expect((await payload.count({ collection: 'submissions', overrideAccess: true })).totalDocs).toBe(before.totalDocs)
  })
  it('surfaces the collection hook message for the pending cap', async () => {
    for (let i = 0; i < 9; i++) await submitListing({ payload, maintainer: alice, url: `https://github.com/alice/p${i}`, note: '' })
    expect(await submitListing({ payload, maintainer: alice, url: 'https://github.com/alice/one-too-many', note: '' })).toEqual({
      status: 'invalid', message: expect.stringMatching(/10 requests/),
    })
  })
  it('enforces the rules server-side even when the pre-check is skipped (hook, over-long note clamped)', async () => {
    const r = await submitListing({ payload, maintainer: bob, url: 'https://github.com/bob/long-note', note: 'x'.repeat(5000) })
    expect(r).toEqual({ status: 'created' })
    const doc = (await payload.find({ collection: 'submissions', overrideAccess: true, depth: 0, where: { url: { equals: 'https://github.com/bob/long-note' } } })).docs[0]
    expect(doc.note).toHaveLength(1000)
  })
})
