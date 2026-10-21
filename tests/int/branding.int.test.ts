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
  const mk = (alt: string, origin: 'maintainer' | 'admin' = 'maintainer') =>
    payload.create({ collection: 'media', overrideAccess: true, data: { alt, origin }, file: { data: PNG, mimetype: 'image/png', name: `${alt}.png`, size: PNG.length } })
  const gone = (id: number) => payload.findByID({ collection: 'media', id, overrideAccess: true, disableErrors: true })
  const future = () => new Date(Date.now() + 2 * 86_400_000)

  it('deletes only unreferenced maintainer media older than a day', async () => {
    const orphan = await mk('orphan-old')
    const fresh = await mk('orphan-fresh')
    const logoId = relationId((await mine()).logo)!
    // "now" two days ahead makes every row old
    expect(await sweepOrphanMedia(payload, new Date())).toBe(0)
    const deleted = await sweepOrphanMedia(payload, future())
    expect(deleted).toBeGreaterThanOrEqual(2)
    expect(await gone(orphan.id)).toBeNull()
    expect(await gone(fresh.id)).toBeNull()
    expect(await gone(logoId)).not.toBeNull()
  })

  it('never deletes admin-uploaded media, however old and unreferenced', async () => {
    const adminUpload = await mk('admin-upload', 'admin')
    const defaulted = await payload.create({ collection: 'media', overrideAccess: true, data: { alt: 'no-origin' }, file: { data: PNG, mimetype: 'image/png', name: 'no-origin.png', size: PNG.length } })
    expect(defaulted.origin).toBe('admin')
    await sweepOrphanMedia(payload, future())
    expect(await gone(adminUpload.id)).not.toBeNull()
    expect(await gone(defaulted.id)).not.toBeNull()
    await payload.delete({ collection: 'media', id: adminUpload.id, overrideAccess: true })
    await payload.delete({ collection: 'media', id: defaulted.id, overrideAccess: true })
  })

  it('saveBranding marks the media it creates as maintainer-owned', async () => {
    await saveBranding({ payload, maintainer: owner, slug: 'mine', tagline: '', logo: { data: PNG } })
    const logo = await payload.findByID({ collection: 'media', id: relationId((await mine()).logo)!, overrideAccess: true, depth: 0 })
    expect(logo.origin).toBe('maintainer')
  })

  it('finds the orphan behind 250 referenced old logos', async () => {
    const created: number[] = []
    for (let i = 0; i < 250; i++) {
      const media = await mk(`live-${i}`)
      created.push(media.id)
      const repo = await payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName: `o/live-${i}`, owner: 'o', url: `https://github.com/o/live-${i}` } as never })
      await payload.create({
        collection: 'plugins', overrideAccess: true, context: { skipRevalidate: true },
        data: { slug: `live-${i}`, name: `Live ${i}`, repository: repo.id, url: repo.url, source: 'topic', visibility: 'listed', logo: media.id } as never,
      })
    }
    const orphan = await mk('late-orphan')
    expect(await sweepOrphanMedia(payload, future())).toBe(1)
    expect(await gone(orphan.id)).toBeNull()
    for (const id of created) expect(await gone(id)).not.toBeNull()
    for (let i = 0; i < 250; i++) {
      const p = (await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, limit: 1, where: { slug: { equals: `live-${i}` } } })).docs[0]
      await payload.delete({ collection: 'plugins', id: p.id, overrideAccess: true, context: { skipRevalidate: true } })
      await payload.delete({ collection: 'media', id: created[i], overrideAccess: true })
    }
  }, 120_000)
  it('deleting a media row removes the original and every variant file from MEDIA_DIR', async () => {
    const big = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#aa3366' } }).png().toBuffer()
    const media = await payload.create({
      collection: 'media', overrideAccess: true, data: { alt: 'variants' },
      file: { data: big, mimetype: 'image/png', name: 'variants.png', size: big.length },
    })
    const dir = process.env.MEDIA_DIR || 'media'
    const variants = (media as unknown as { variants?: Record<string, { filename?: string | null }> }).variants ?? {}
    const names = [media.filename, variants.gallery?.filename, variants.card?.filename].filter((n): n is string => Boolean(n))
    expect(names.length).toBe(3)
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    const exists = async (n: string) => fs.stat(path.join(dir, n)).then(() => true, () => false)
    for (const n of names) expect(await exists(n)).toBe(true)
    await payload.delete({ collection: 'media', id: media.id, overrideAccess: true })
    for (const n of names) expect(await exists(n)).toBe(false)
  })
})
