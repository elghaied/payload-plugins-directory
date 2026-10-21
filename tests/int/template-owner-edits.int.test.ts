import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { Forbidden, type Payload } from 'payload'
import sharp from 'sharp'
import type { CurrentMaintainer } from '@/lib/auth/current'
import { sweepOrphanMedia } from '@/lib/maintainers/mediaCleanup'
import { loadMeData } from '@/lib/maintainers/meData'
import {
  addTemplateScreenshot,
  moveTemplateScreenshot,
  removeTemplateScreenshot,
  saveTemplateDetails,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_MAX_COUNT,
  SCREENSHOT_MAX_DIMENSION,
} from '@/lib/maintainers/templateEdits'
import { relationId } from '@/lib/relationId'
import { getTestPayload, resetDatabase } from './helpers/payload'

// Server actions run here with the test Payload and a fixed maintainer; next/cache is a no-op outside a request.
const holder = vi.hoisted(() => ({ payload: undefined as unknown, maintainer: null as unknown }))
vi.mock('payload', async (importOriginal) => {
  const original = await importOriginal<typeof import('payload')>()
  return { ...original, getPayload: (args: never) => (holder.payload ? Promise.resolve(holder.payload) : original.getPayload(args)) }
})
vi.mock('@/lib/auth/current', () => ({ getCurrentMaintainer: async () => holder.maintainer }))
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidatePath: vi.fn(), revalidateTag: vi.fn() }))

let payload: Payload
let owner: CurrentMaintainer
let other: CurrentMaintainer
let PNG: Buffer
let otherShotId: number
let adminMediaId: number

const tpl = async (slug = 'tpl') => (await payload.find({ collection: 'templates', overrideAccess: true, depth: 0, where: { slug: { equals: slug } } })).docs[0]
const shots = async (slug = 'tpl') => ((await tpl(slug)).screenshots ?? []).map(relationId) as number[]
const mediaCount = async () => (await payload.count({ collection: 'media', overrideAccess: true })).totalDocs
const media = (id: number) => payload.findByID({ collection: 'media', id, overrideAccess: true, depth: 0, disableErrors: true })
const mkMedia = (alt: string, origin: 'admin' | 'template-screenshot' | 'maintainer') =>
  payload.create({ collection: 'media', overrideAccess: true, data: { alt, origin }, file: { data: PNG, mimetype: 'image/png', name: `${alt}.png`, size: PNG.length } })
const form = (entries: Record<string, string | Blob>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(entries)) f.set(k, v)
  return f
}

beforeAll(async () => {
  payload = await getTestPayload()
  holder.payload = payload
  await resetDatabase(payload)
  PNG = await sharp({ create: { width: 64, height: 40, channels: 3, background: '#336699' } }).png().toBuffer()
  owner = { ...(await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 1, login: 'owner' } })), collection: 'maintainers' }
  other = { ...(await payload.create({ collection: 'maintainers', overrideAccess: true, data: { githubId: 2, login: 'other' } })), collection: 'maintainers' }
  const repo = await payload.create({ collection: 'repositories', overrideAccess: true, data: { fullName: 'o/t', owner: 'o', githubId: 9, url: 'https://github.com/o/t' } })
  const otherShot = await mkMedia('other-shot', 'template-screenshot')
  otherShotId = otherShot.id
  adminMediaId = (await mkMedia('admin-logo', 'admin')).id
  for (const [slug, maintainer, screenshots] of [['tpl', owner.id, []], ['other-tpl', other.id, [otherShot.id]]] as const) {
    await payload.create({
      collection: 'templates', overrideAccess: true, context: { skipRevalidate: true },
      data: { slug, name: slug === 'tpl' ? 'Starter' : 'Other', repository: repo.id, url: repo.url, source: 'submission', visibility: 'listed', maintainers: [maintainer], screenshots: [...screenshots] } as never,
    })
  }
})
afterAll(async () => {
  const all = await payload.find({ collection: 'media', overrideAccess: true, limit: 0, pagination: false })
  for (const m of all.docs) await payload.delete({ collection: 'media', id: m.id, overrideAccess: true })
  await resetDatabase(payload)
})

describe('limits', () => {
  it('exports the screenshot limits', () => {
    expect([SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_DIMENSION, SCREENSHOT_MAX_COUNT]).toEqual([2 * 1024 * 1024, 4096, 8])
  })
})

describe('saveTemplateDetails', () => {
  const base = { tagline: '', demoUrl: '', videoUrl: '', stackOverride: '' }
  it('rejects a javascript: demo URL and writes nothing', async () => {
    const result = await saveTemplateDetails({ payload, maintainer: owner, slug: 'tpl', ...base, tagline: 'x', demoUrl: 'javascript:alert(1)' })
    expect(result).toMatchObject({ status: 'invalid' })
    expect((await tpl()).customTagline ?? null).toBeNull()
  })
  it.each([['videoUrl', 'https://evil.example.com/v'], ['stackOverride', 'rails'], ['tagline', 'x'.repeat(121)]])('rejects an invalid %s', async (key, value) => {
    expect(await saveTemplateDetails({ payload, maintainer: owner, slug: 'tpl', ...base, [key]: value })).toMatchObject({ status: 'invalid' })
  })
  it('saves valid values, normalised', async () => {
    const result = await saveTemplateDetails({
      payload, maintainer: owner, slug: 'tpl', tagline: '  A  starter ', demoUrl: 'https://demo.example.com/', videoUrl: 'https://youtu.be/dQw4w9WgXcQ', stackOverride: 'tanstack-start',
    })
    expect(result).toEqual({ status: 'saved' })
    expect(await tpl()).toMatchObject({
      customTagline: 'A starter', demoUrl: 'https://demo.example.com/', videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', stackOverride: 'tanstack-start',
    })
  })
  it('clears values with empty input', async () => {
    expect(await saveTemplateDetails({ payload, maintainer: owner, slug: 'tpl', ...base })).toEqual({ status: 'saved' })
    const doc = await tpl()
    expect([doc.customTagline, doc.demoUrl, doc.videoUrl, doc.stackOverride].map((v) => v ?? null)).toEqual([null, null, null, null])
  })
  it('a non-owner gets forbidden', async () => {
    expect(await saveTemplateDetails({ payload, maintainer: other, slug: 'tpl', ...base, tagline: 'hijack' })).toEqual({ status: 'forbidden' })
    expect((await tpl()).customTagline ?? null).toBeNull()
  })
  it('the server action ignores extra form keys', async () => {
    const { saveTemplateDetailsAction } = await import('@/app/(site)/me/actions')
    holder.maintainer = owner
    const result = await saveTemplateDetailsAction({ status: 'idle' }, form({
      slug: 'tpl', tagline: 'Via action', demoUrl: '', videoUrl: '', stackOverride: '',
      name: 'Hijacked', visibility: 'hidden', screenshots: String(otherShotId), maintainers: String(other.id), isOfficial: 'true',
    }))
    expect(result).toEqual({ status: 'saved' })
    const doc = await tpl()
    expect(doc).toMatchObject({ name: 'Starter', visibility: 'listed', customTagline: 'Via action', isOfficial: false })
    expect((doc.maintainers ?? []).map(relationId)).toEqual([owner.id])
    expect(await shots()).toEqual([])
  })
})

describe('Local API as the maintainer', () => {
  it('setting screenshots to another template\'s media without the context key is Forbidden', async () => {
    const doc = await tpl()
    await expect(payload.update({ collection: 'templates', id: doc.id, overrideAccess: false, user: owner, data: { screenshots: [otherShotId] } })).rejects.toThrow(Forbidden)
    expect(await shots()).toEqual([])
  })
  it('setting name is Forbidden', async () => {
    const doc = await tpl()
    await expect(payload.update({ collection: 'templates', id: doc.id, overrideAccess: false, user: owner, data: { name: 'x' } })).rejects.toThrow(Forbidden)
  })
})

describe('addTemplateScreenshot', () => {
  it('refuses an SVG renamed .png', async () => {
    const before = await mediaCount()
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: svg } })).toMatchObject({ status: 'invalid' })
    const html = Buffer.from('<!doctype html><script>alert(1)</script>')
    expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: html } })).toMatchObject({ status: 'invalid' })
    expect(await mediaCount()).toBe(before)
  })
  it('refuses a decompression bomb (8000 x 8000 PNG under 2 MB) and leaves no media row', async () => {
    const bomb = await sharp({ create: { width: 8000, height: 8000, channels: 3, background: '#000000' } }).png({ compressionLevel: 9 }).toBuffer()
    expect(bomb.length).toBeLessThan(SCREENSHOT_MAX_BYTES)
    const before = await mediaCount()
    expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: bomb } })).toMatchObject({
      status: 'invalid', message: expect.stringContaining('4096'),
    })
    expect(await mediaCount()).toBe(before)
  }, 60_000)
  it('refuses a 2.1 MB file', async () => {
    const before = await mediaCount()
    const big = Buffer.concat([PNG, Buffer.alloc(Math.ceil(2.1 * 1024 * 1024))])
    expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: big } })).toMatchObject({ status: 'invalid' })
    expect(await mediaCount()).toBe(before)
  })
  it('refuses a non-owner without uploading anything', async () => {
    const before = await mediaCount()
    expect(await addTemplateScreenshot({ payload, maintainer: other, slug: 'tpl', file: { data: PNG } })).toEqual({ status: 'forbidden' })
    expect(await mediaCount()).toBe(before)
  })
  it('stores a valid PNG as WebP with card and gallery variants and origin template-screenshot', async () => {
    const png = await sharp({ create: { width: 2000, height: 1200, channels: 3, background: '#aa3366' } }).png().toBuffer()
    expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: png } })).toEqual({ status: 'saved' })
    const ids = await shots()
    expect(ids).toHaveLength(1)
    const doc = (await media(ids[0]))!
    expect(doc).toMatchObject({ mimeType: 'image/webp', origin: 'template-screenshot', alt: 'Starter screenshot' })
    expect(doc.variants?.card?.url).toBeTruthy()
    expect(doc.variants?.gallery?.url).toBeTruthy()
  })
  it('refuses a 9th screenshot', async () => {
    while ((await shots()).length < SCREENSHOT_MAX_COUNT) {
      expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: PNG } })).toEqual({ status: 'saved' })
    }
    const before = await mediaCount()
    expect(await addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: PNG } })).toEqual({
      status: 'invalid', message: 'A template can have at most 8 screenshots.',
    })
    expect(await mediaCount()).toBe(before)
    expect(await shots()).toHaveLength(SCREENSHOT_MAX_COUNT)
  }, 60_000)
})

describe('removeTemplateScreenshot and moveTemplateScreenshot', () => {
  it('remove with a media id the template does not reference is forbidden and deletes nothing', async () => {
    const before = await shots()
    for (const mediaId of [otherShotId, adminMediaId, 0, -1, 999999]) {
      expect(await removeTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', mediaId })).toEqual({ status: 'forbidden' })
    }
    expect(await media(otherShotId)).not.toBeNull()
    expect(await media(adminMediaId)).not.toBeNull()
    expect(await shots()).toEqual(before)
  })
  it('a non-owner cannot remove or move', async () => {
    const [first] = await shots()
    expect(await removeTemplateScreenshot({ payload, maintainer: other, slug: 'tpl', mediaId: first })).toEqual({ status: 'forbidden' })
    expect(await moveTemplateScreenshot({ payload, maintainer: other, slug: 'tpl', mediaId: first, direction: 'down' })).toEqual({ status: 'forbidden' })
    expect(await media(first)).not.toBeNull()
  })
  it('moves a screenshot up and down; the ends are no-ops', async () => {
    const [a, b, ...rest] = await shots()
    expect(await moveTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', mediaId: a, direction: 'down' })).toEqual({ status: 'saved' })
    expect(await shots()).toEqual([b, a, ...rest])
    expect(await moveTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', mediaId: a, direction: 'up' })).toEqual({ status: 'saved' })
    expect(await shots()).toEqual([a, b, ...rest])
    expect(await moveTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', mediaId: a, direction: 'up' })).toEqual({ status: 'saved' })
    expect(await shots()).toEqual([a, b, ...rest])
    expect(await moveTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', mediaId: otherShotId, direction: 'up' })).toEqual({ status: 'forbidden' })
  })
  it('removes a referenced screenshot and deletes its media', async () => {
    const [a, ...rest] = await shots()
    expect(await removeTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', mediaId: a })).toEqual({ status: 'saved' })
    expect(await shots()).toEqual(rest)
    expect(await media(a)).toBeNull()
  })
  it('the remove action parses mediaId as a positive integer', async () => {
    const { removeTemplateScreenshotAction } = await import('@/app/(site)/me/actions')
    holder.maintainer = owner
    const before = await shots()
    for (const mediaId of ['1.5', 'abc', '-3', '', `${otherShotId}`]) {
      expect(await removeTemplateScreenshotAction({ status: 'idle' }, form({ slug: 'tpl', mediaId }))).toEqual({ status: 'forbidden' })
    }
    expect(await shots()).toEqual(before)
  })
})

describe('loadMeData (templates)', () => {
  it('lists only the templates the maintainer maintains, with populated screenshots, and template claims', async () => {
    const doc = await tpl()
    await payload.create({ collection: 'submissions', overrideAccess: false, user: other, data: { type: 'claim', kind: 'template', template: doc.id } as never })
    const mine = await loadMeData(payload, owner)
    expect(mine.templates.map((t) => t.slug)).toEqual(['tpl'])
    const first = mine.templates[0].screenshots?.[0]
    expect(typeof first === 'object' && first?.variants?.card?.url).toBeTruthy()
    const theirs = await loadMeData(payload, other)
    expect(theirs.templates.map((t) => t.slug)).toEqual(['other-tpl'])
    expect(theirs.claims).toHaveLength(1)
    expect(theirs.claims[0]).toMatchObject({ kind: 'template', template: expect.objectContaining({ slug: 'tpl', name: 'Starter' }) })
  })
})

describe('sweepOrphanMedia (template screenshots)', () => {
  const future = () => new Date(Date.now() + 2 * 86_400_000)
  it('two uploads racing past 8 never store a 9th, and the loser is swept', async () => {
    expect(await shots()).toHaveLength(SCREENSHOT_MAX_COUNT - 1)
    const results = await Promise.all([1, 2, 3].map(() => addTemplateScreenshot({ payload, maintainer: owner, slug: 'tpl', file: { data: PNG } })))
    expect(results.some((r) => r.status === 'saved')).toBe(true)
    expect(await shots()).toHaveLength(SCREENSHOT_MAX_COUNT)
    await sweepOrphanMedia(payload, future())
    const left = await payload.find({ collection: 'media', overrideAccess: true, depth: 0, pagination: false, limit: 0, where: { origin: { equals: 'template-screenshot' } } })
    expect(left.docs.map((d) => d.id).sort()).toEqual([...(await shots()), otherShotId].sort())
  }, 60_000)
  it('deletes an unreferenced template-screenshot row older than a day; keeps referenced and admin rows', async () => {
    const orphan = await mkMedia('tpl-orphan', 'template-screenshot')
    const referenced = await shots()
    await sweepOrphanMedia(payload, future())
    expect(await media(orphan.id)).toBeNull()
    for (const id of referenced) expect(await media(id)).not.toBeNull()
    expect(await media(otherShotId)).not.toBeNull()
    expect(await media(adminMediaId)).not.toBeNull()
  })
  it('a trashed template still references its screenshots', async () => {
    const doc = await tpl('other-tpl')
    await payload.update({ collection: 'templates', id: doc.id, overrideAccess: true, context: { skipRevalidate: true }, data: { deletedAt: new Date().toISOString() } })
    await sweepOrphanMedia(payload, future())
    expect(await media(otherShotId)).not.toBeNull()
  })
})
