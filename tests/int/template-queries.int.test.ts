import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import type { Template } from '@/payload-types'
import { readmeStamp } from '@/lib/directory/readmeStamp'
import { seedTemplateCategories } from '@/taxonomy/templateSeed'
import { createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'

const cacheKeys = vi.hoisted(() => [] as string[][])
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, keyParts: string[]) => {
    cacheKeys.push(keyParts)
    return fn
  },
}))

const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64')

let payload: Payload
const ids: Record<string, number> = {}

async function mk(repository: number, slug: string, over: Partial<Template> = {}): Promise<Template> {
  return payload.create({
    collection: 'templates',
    overrideAccess: true,
    depth: 0,
    context: { skipRevalidate: true },
    data: { slug, name: slug, repository, url: `https://github.com/acme/${slug}`, source: 'submission', payloadMajors: ['3'], stackDetected: 'nextjs', ...over } as never,
  })
}

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await seedTemplateCategories(payload)
  const cats = await payload.find({ collection: 'template-categories', overrideAccess: true, limit: 0, pagination: false })
  const cat = (slug: string) => cats.docs.find((c) => c.slug === slug)!.id
  const official = await createRepo(payload, { fullName: 'payloadcms/payload', owner: 'payloadcms', stars: 40_000 })
  const community = await createRepo(payload, { fullName: 'acme/shop', owner: 'acme', stars: 50 })
  const media = await payload.create({
    collection: 'media', overrideAccess: true, data: { alt: 'Shop home' },
    file: { data: PNG_1X1, mimetype: 'image/png', name: 'shot.png', size: PNG_1X1.length },
  })
  ids.website = (await mk(official.id, 'website', { isOfficial: true, source: 'official', path: 'templates/website', category: cat('landing-pages'), lastUpdatedAt: '2026-10-01T00:00:00.000Z' })).id
  ids.shop = (await mk(community.id, '7-root', { name: 'Shop', category: cat('landing-pages'), screenshots: [media.id], readme: '# Shop', readmeHtml: '<h1>Shop</h1>', readmeRenderVersion: readmeStamp('v1', '# Shop'), fallbackImageUrl: 'https://raw.githubusercontent.com/acme/shop/main/x.png' })).id
  ids.stale = (await mk(community.id, '8-root', { name: 'Stale', category: cat('portfolios'), readme: 'changed', readmeHtml: '<p>old</p>', readmeRenderVersion: readmeStamp('v1', 'older text'), fallbackImageUrl: 'https://evil.example.com/x.png' })).id
  await mk(community.id, '9-root', { name: 'Hidden', category: cat('landing-pages'), visibility: 'hidden' })
  const trashed = await mk(community.id, '10-root', { name: 'Trashed', category: cat('landing-pages') })
  await payload.update({ collection: 'templates', id: trashed.id, overrideAccess: true, context: { skipRevalidate: true }, data: { deletedAt: new Date().toISOString() } })
})
afterAll(async () => resetDatabase(payload))

describe('template queries', () => {
  it('lists only listed, non-trashed templates, official first', async () => {
    const { getTemplateSummaries } = await import('@/lib/templates/queries')
    const list = await getTemplateSummaries()
    expect(list.map((t) => t.slug)).toEqual(['website', '7-root', '8-root'])
    expect(list[0]).toMatchObject({ stars: null, isOfficial: true, lastUpdate: '2026-10-01T00:00:00.000Z', categoryPath: 'landing-pages' })
    expect(list[1].stars).toBe(50)
  })

  it('uses the screenshot card image, else the allow-listed fallback, else GitHub social card', async () => {
    const { getTemplateSummaries } = await import('@/lib/templates/queries')
    const bySlug = Object.fromEntries((await getTemplateSummaries()).map((t) => [t.slug, t]))
    expect(bySlug['7-root'].image.local).toBe(true)
    expect(bySlug['7-root'].image.src).toMatch(/\/api\/media\/file\//)
    // A stored host that is not allow-listed is never used.
    expect(bySlug['8-root'].image).toEqual({ src: 'https://opengraph.githubassets.com/1/acme/shop', local: false })
    expect(bySlug.website.image).toEqual({ src: '', local: true, panel: true })
  })

  it('returns null for hidden, trashed and unknown details, without per-slug cache entries', async () => {
    const { getTemplateDetail } = await import('@/lib/templates/queries')
    cacheKeys.length = 0
    for (const slug of ['9-root', '10-root', 'does-not-exist']) expect(await getTemplateDetail(slug)).toBeNull()
    expect(cacheKeys.filter((k) => k[0] === 'template-detail')).toEqual([])
    await getTemplateDetail('7-root')
    expect(cacheKeys.filter((k) => k[0] === 'template-detail')).toEqual([['template-detail', '7-root']])
  })

  it('includes readmeHtml only when the stamp matches the README text', async () => {
    const { getTemplateDetail } = await import('@/lib/templates/queries')
    const ok = await getTemplateDetail('7-root')
    expect(ok?.readmeHtml).toBe('<h1>Shop</h1>')
    expect(ok?.screenshots).toHaveLength(1)
    expect(ok?.screenshots[0].alt).toBe('Shop home')
    expect(ok?.getStarted).toEqual({ kind: 'command', value: 'git clone https://github.com/acme/shop.git' })
    const stale = await getTemplateDetail('8-root')
    expect(stale).not.toBeNull()
    expect(stale?.readmeHtml).toBeUndefined()
    expect(stale?.readmeFull).toBe('changed')
  })

  it('never exposes admin-only fields in a public read', async () => {
    const res = await payload.find({ collection: 'templates', overrideAccess: false, user: null, depth: 0, limit: 0 })
    for (const d of res.docs) {
      expect(d).not.toHaveProperty('readmeHtml')
      expect(d).not.toHaveProperty('fallbackImageUrl')
    }
  })

  it('counts only listed templates on category pages and the index', async () => {
    const { getTemplateCategoryPage, getTemplateCategoryIndex } = await import('@/lib/templates/queries')
    const page = await getTemplateCategoryPage('landing-pages')
    expect(page?.templates.map((t) => t.slug)).toEqual(['website', '7-root'])
    expect(page?.node.title).toBe('Landing pages')
    const index = await getTemplateCategoryIndex()
    expect(index.find((o) => o.slug === 'landing-pages')?.count).toBe(2)
    expect(index.find((o) => o.slug === 'portfolios')?.count).toBe(1)
    expect(await getTemplateCategoryPage('nope')).toBeNull()
  })

  it('finds similar templates from the same category, never hidden ones', async () => {
    const { getSimilarTemplates } = await import('@/lib/templates/queries')
    expect((await getSimilarTemplates('7-root')).map((t) => t.slug)).toEqual(['website'])
    expect(await getSimilarTemplates('9-root')).toEqual([])
  })
})
