import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import sharp from 'sharp'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { saveBranding } from '@/lib/maintainers/branding'
import { relationId } from '@/lib/relationId'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
let owner: CurrentMaintainer
let other: CurrentMaintainer
let PNG: Buffer

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  PNG = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#336699' } }).png().toBuffer()
  const a = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'owner' } })
  const b = await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 2, login: 'other' } })
  owner = { ...a, collection: 'maintainers' }
  other = { ...b, collection: 'maintainers' }
  const repo = await payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName: 'o/p', owner: 'o', url: 'https://github.com/o/p' } as never })
  await payload.create({
    collection: 'plugins', overrideAccess: true, context: { skipRevalidate: true },
    data: { slug: 'mine', name: 'Mine', repository: repo.id, url: repo.url, source: 'topic', visibility: 'listed', maintainers: [a.id] } as never,
  })
})
afterAll(async () => {
  const media = await payload.find({ collection: 'media', overrideAccess: true, limit: 100 })
  for (const m of media.docs) await payload.delete({ collection: 'media', id: m.id, overrideAccess: true })
  await resetDatabase(payload)
})

const mine = async () =>
  (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, where: { slug: { equals: 'mine' } } })).docs[0]
const mediaCount = async () => (await payload.count({ collection: 'media', overrideAccess: true })).totalDocs

describe('saveBranding', () => {
  it('sets and clears the tagline', async () => {
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: ' Fast  forms ' })).toEqual({ status: 'saved' })
    expect((await mine()).customTagline).toBe('Fast forms')
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '' })
    expect((await mine()).customTagline ?? null).toBeNull()
  })
  it('rejects a tagline over 120 characters', async () => {
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: 'x'.repeat(121) })).toMatchObject({ status: 'invalid' })
  })
  it('uploads a PNG logo and replaces it, deleting the old file record', async () => {
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })
    const first = relationId((await mine()).logo)
    expect(first).toEqual(expect.any(Number))
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })
    const second = relationId((await mine()).logo)
    expect(second).not.toBe(first)
    const old = await payload.findByID({ collection: 'media', id: first!, overrideAccess: true, disableErrors: true })
    expect(old).toBeNull()
  })
  it('removes the logo', async () => {
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', removeLogo: true })
    expect((await mine()).logo ?? null).toBeNull()
  })
  it('rejects SVG, oversized and over-dimension logos without creating media', async () => {
    const before = await mediaCount()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: svg } })).toMatchObject({ status: 'invalid' })
    const big = Buffer.concat([PNG, Buffer.alloc(600 * 1024)])
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: big } })).toMatchObject({ status: 'invalid' })
    const wide = await sharp({ create: { width: 3000, height: 10, channels: 3, background: '#000' } }).png().toBuffer()
    expect(wide.length).toBeLessThan(512 * 1024)
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: wide } })).toMatchObject({ status: 'invalid' })
    expect(await mediaCount()).toBe(before)
  })
  it('refuses a maintainer who does not maintain the plugin, without uploading anything', async () => {
    const before = await mediaCount()
    expect(await saveBranding({ payload, maintainer: other, slug: 'mine', tagline: 'hijack', logo: { data: PNG } })).toEqual({ status: 'forbidden' })
    expect((await mine()).customTagline ?? null).toBeNull()
    expect(await mediaCount()).toBe(before)
  })
  it('refuses an unknown slug', async () => {
    expect(await saveBranding({ payload, maintainer: owner, slug: 'nope', tagline: 'x' })).toEqual({ status: 'forbidden' })
  })
})
