import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { seedTemplateCategories } from '@/taxonomy/templateSeed'
import { STARTER_TEMPLATE_CATEGORIES, TEMPLATE_FALLBACK_CATEGORY_SLUG } from '@/taxonomy/templateStarter'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

const SLUGS = ['landing-pages', 'portfolios', 'blogs-publishing', 'ecommerce', 'saas-dashboards', 'business-agency', 'docs-knowledge', 'starters-boilerplates']

describe('template categories', () => {
  it('seeds the 8 starter categories once and is idempotent', async () => {
    expect(STARTER_TEMPLATE_CATEGORIES.map((c) => c.slug)).toEqual(SLUGS)
    expect(TEMPLATE_FALLBACK_CATEGORY_SLUG).toBe('starters-boilerplates')
    const first = await seedTemplateCategories(payload)
    expect(first.created).toEqual(SLUGS)
    const docs = await payload.find({ collection: 'template-categories', overrideAccess: true, limit: 0, pagination: false })
    expect(docs.docs.map((d) => d.slug).sort()).toEqual([...SLUGS].sort())
    expect(docs.docs.find((d) => d.slug === 'portfolios')?.title).toBe('Portfolios & personal')
    expect((await seedTemplateCategories(payload)).created).toEqual([])
  })

  it('keeps an admin rename across re-runs', async () => {
    await seedTemplateCategories(payload)
    const doc = (await payload.find({ collection: 'template-categories', overrideAccess: true, where: { slug: { equals: 'ecommerce' } } })).docs[0]
    await payload.update({ collection: 'template-categories', id: doc.id, overrideAccess: true, context: { skipRevalidate: true }, data: { title: 'Shops' } })
    await seedTemplateCategories(payload)
    const after = (await payload.find({ collection: 'template-categories', overrideAccess: true, where: { slug: { equals: 'ecommerce' } } })).docs[0]
    expect(after.title).toBe('Shops')
  })

  it('is publicly readable but not writable', async () => {
    await seedTemplateCategories(payload)
    const found = await payload.find({ collection: 'template-categories', overrideAccess: false, user: null, limit: 0, pagination: false })
    expect(found.docs).toHaveLength(8)
    await expect(
      payload.create({ collection: 'template-categories', overrideAccess: false, user: null, data: { title: 'X', slug: 'x' } }),
    ).rejects.toThrow(/not allowed|forbidden/i)
  })

  it('computes _h_slugPath on request', async () => {
    await seedTemplateCategories(payload)
    const doc = (
      await payload.find({
        collection: 'template-categories',
        overrideAccess: true,
        context: { computeHierarchyPaths: true },
        where: { slug: { equals: 'landing-pages' } },
      })
    ).docs[0]
    expect(doc._h_slugPath).toBe('landing-pages')
  })
})
