import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { getTestPayload, resetDatabase } from './helpers/payload'

let payload: Payload
const revalidateInputs = async () =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, sort: 'createdAt', where: { taskSlug: { equals: 'revalidate' } } })).docs.map((j) => j.input)

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('taxonomy revalidation hooks', () => {
  it('revalidates the list and the category on create, rename and delete', async () => {
    const cat = await payload.create({ collection: 'categories', overrideAccess: true, data: { title: 'SEO', slug: 'seo' } })
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, data: { slug: 'seo-metadata' } })
    await payload.delete({ collection: 'categories', id: cat.id, overrideAccess: true })
    expect(await revalidateInputs()).toEqual([
      { tags: ['plugins', 'category:seo'] },
      { tags: ['plugins', 'category:seo-metadata', 'category:seo'] },
      { tags: ['plugins', 'category:seo-metadata'] },
    ])
  })

  it('revalidates the list on tag changes and stays quiet for seeding', async () => {
    await payload.create({ collection: 'tags', overrideAccess: true, data: { title: 'S3', slug: 's3' } })
    await payload.create({ collection: 'tags', overrideAccess: true, context: { skipRevalidate: true }, data: { title: 'R2', slug: 'r2' } })
    expect(await revalidateInputs()).toEqual([{ tags: ['plugins'] }])
  })

  it('stays quiet for category edits and deletes that carry skipRevalidate', async () => {
    const context = { skipRevalidate: true }
    const cat = await payload.create({ collection: 'categories', overrideAccess: true, context, data: { title: 'Q', slug: 'q' } })
    await payload.update({ collection: 'categories', id: cat.id, overrideAccess: true, context, data: { slug: 'q2' } })
    await payload.delete({ collection: 'categories', id: cat.id, overrideAccess: true, context })
    expect(await revalidateInputs()).toEqual([])
  })
})
