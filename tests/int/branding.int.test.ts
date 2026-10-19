import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import sharp from 'sharp'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { saveBranding } from '@/lib/maintainers/branding'
import { sweepOrphanMedia } from '@/lib/maintainers/mediaCleanup'
import { loadMeData } from '@/lib/maintainers/meData'
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

const PLUGIN_DEFAULTS = { source: 'topic', visibility: 'listed' } as const
async function makePlugin(slug: string, extra: Record<string, unknown> = {}) {
  const repo = await payload.create({
    collection: 'repositories', overrideAccess: true,
    data: { fullName: `o/${slug}`, owner: 'o', url: `https://github.com/o/${slug}` } as never,
  })
  return payload.create({
    collection: 'plugins', overrideAccess: true, context: { skipRevalidate: true },
    data: { slug, name: slug, repository: repo.id, url: repo.url, ...PLUGIN_DEFAULTS, maintainers: [owner.id], ...extra } as never,
  })
}

describe('saveBranding polish', () => {
  it('re-encodes the logo: a JPEG with EXIF GPS is stored without EXIF', async () => {
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#aa3300' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '40/1 26/1 46/1' } })
      .toBuffer()
    expect((await sharp(jpeg).metadata()).exif).toBeDefined()
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: jpeg } })).toEqual({ status: 'saved' })
    const media = await payload.findByID({ collection: 'media', id: relationId((await mine()).logo)!, overrideAccess: true, depth: 0 })
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const file = await fs.readFile(path.join(process.env.MEDIA_DIR || 'media', media.filename!))
    expect(file.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect((await sharp(file).metadata()).exif).toBeUndefined()
    expect(file.includes(Buffer.from('secret'))).toBe(false)
  })
  it('shows the size message for an image over 2048 x 2048', async () => {
    const huge = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: '#000' } }).png().toBuffer()
    expect(huge.length).toBeLessThan(512 * 1024)
    expect(await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: huge } })).toMatchObject({
      status: 'invalid', message: expect.stringContaining('2048'),
    })
  })
  it('deletes the created media when the plugin update fails, and surfaces the original error', async () => {
    const before = await mediaCount()
    const update = vi.spyOn(payload, 'update').mockRejectedValueOnce(new Error('boom'))
    await expect(saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })).rejects.toThrow('boom')
    update.mockRestore()
    expect(await mediaCount()).toBe(before)
  })
  it('does not mask the original error when the compensating delete also fails', async () => {
    const update = vi.spyOn(payload, 'update').mockRejectedValueOnce(new Error('boom'))
    const del = vi.spyOn(payload, 'delete').mockRejectedValueOnce(new Error('delete failed'))
    await expect(saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })).rejects.toThrow('boom')
    update.mockRestore()
    del.mockRestore()
    // the leftover is an orphan: the sweep removes it once it is a day old
    const orphans = (await payload.find({ collection: 'media', overrideAccess: true, limit: 100 })).docs
    expect(await sweepOrphanMedia(payload, new Date(Date.now() + 2 * 86_400_000))).toBeGreaterThanOrEqual(orphans.length - 1)
  })
  it('still reports saved when deleting the old logo fails', async () => {
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })
    const del = vi.spyOn(payload, 'delete').mockRejectedValue(new Error('disk'))
    const result = await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })
    del.mockRestore()
    expect(result).toEqual({ status: 'saved' })
  })
  it('leaves exactly one media row after parallel uploads and a sweep', async () => {
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', removeLogo: true })
    await sweepOrphanMedia(payload, new Date(Date.now() + 2 * 86_400_000))
    await Promise.all([1, 2, 3].map(() => saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })))
    // A racing save can still leave a loser behind (its own check ran while it was referenced): the daily sweep removes it.
    await sweepOrphanMedia(payload, new Date(Date.now() + 2 * 86_400_000))
    const final = relationId((await mine()).logo)
    const rows = (await payload.find({ collection: 'media', overrideAccess: true, limit: 100 })).docs.map((m) => m.id)
    expect(rows).toEqual([final])
  })
  it('refuses hidden, trashed and removed-maintainer plugins without uploading', async () => {
    await makePlugin('hid', { visibility: 'hidden' })
    const trashed = await makePlugin('trash')
    await payload.update({ collection: 'plugins', id: trashed.id, overrideAccess: true, context: { skipRevalidate: true }, data: { deletedAt: new Date().toISOString() } })
    await makePlugin('removed', { maintainers: [other.id] })
    const before = await mediaCount()
    for (const slug of ['hid', 'trash', 'removed']) {
      expect(await saveBranding({ payload, maintainer: owner, slug, tagline: 'x', logo: { data: PNG } })).toEqual({ status: 'forbidden' })
    }
    expect(await mediaCount()).toBe(before)
  })
})

describe('sweepOrphanMedia', () => {
  it('deletes only unreferenced media older than a day', async () => {
    const mk = (alt: string) =>
      payload.create({ collection: 'media', overrideAccess: true, data: { alt }, file: { data: PNG, mimetype: 'image/png', name: `${alt}.png`, size: PNG.length } })
    const orphan = await mk('orphan-old')
    const fresh = await mk('orphan-fresh')
    const logoId = relationId((await mine()).logo)!
    const future = new Date(Date.now() + 2 * 86_400_000)
    // "now" two days ahead makes every row old; the fresh one is protected by moving "now" back instead
    expect(await sweepOrphanMedia(payload, new Date())).toBe(0)
    const deleted = await sweepOrphanMedia(payload, future)
    expect(deleted).toBeGreaterThanOrEqual(2)
    const gone = (id: number) => payload.findByID({ collection: 'media', id, overrideAccess: true, disableErrors: true })
    expect(await gone(orphan.id)).toBeNull()
    expect(await gone(fresh.id)).toBeNull()
    expect(await gone(logoId)).not.toBeNull()
  })
})

describe('loadMeData', () => {
  it('returns only the maintainer\'s own plugins, listings and claims', async () => {
    const mineP = await mine()
    const theirs = await makePlugin('theirs', { maintainers: [other.id] })
    const mk = (who: CurrentMaintainer, data: Record<string, unknown>) =>
      payload.create({ collection: 'submissions', overrideAccess: true, data: { submittedBy: who.id, ...data } as never })
    await mk(owner, { type: 'listing', url: 'https://github.com/o/own-listing' })
    await mk(other, { type: 'listing', url: 'https://github.com/o/other-listing' })
    await mk(owner, { type: 'claim', plugin: theirs.id })
    await mk(other, { type: 'claim', plugin: mineP.id })
    const data = await loadMeData(payload, owner)
    expect(data.plugins.map((p) => p.slug)).toContain('mine')
    expect(data.plugins.map((p) => p.slug)).not.toContain('theirs')
    expect(data.listings.map((s) => s.url)).toEqual(['https://github.com/o/own-listing'])
    expect(data.claims).toHaveLength(1)
    expect(data.truncated).toBe(false)
  })
})
