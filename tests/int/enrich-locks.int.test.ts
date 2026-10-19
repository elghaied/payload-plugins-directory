import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import type { Plugin } from '@/payload-types'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy } from './helpers/taxonomy'

let payload: Payload
let plugin: Plugin
let admin: Record<string, unknown>
let tax: Awaited<ReturnType<typeof createTestTaxonomy>>

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  tax = await createTestTaxonomy(payload)
  const user = await payload.create({ collection: 'users', overrideAccess: true, data: { email: 'admin@example.dev', password: 'correct-horse-9' } })
  admin = { ...user, collection: 'users' }
  const repo = await createRepo(payload)
  plugin = await createPlugin(payload, repo.id, {
    slug: 'p1',
    ai: { summary: 'AI text', tagline: 'AI tagline', features: ['a', 'b'] },
    _h_tags: [tax.seo.id, tax.s3.id],
  } as never)
})
afterAll(async () => resetDatabase(payload))

const asAdmin = (data: Record<string, unknown>) =>
  payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: false, user: admin as never, depth: 0, data: data as never })
const locksOf = async () => (await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 0 })).locks

describe('lockAdminEditedAiFields', () => {
  it('locks the fields an admin changes and nothing else', async () => {
    await asAdmin({ ai: { summary: 'Corrected by hand', tagline: 'AI tagline' }, category: tax.other.id })
    expect(await locksOf()).toMatchObject({ summary: true, category: true, tagline: false, tags: false, features: false, useCases: false })
  })

  it('locks only the tagline when only the tagline changes', async () => {
    await asAdmin({ ai: { tagline: 'New tagline' } })
    expect(await locksOf()).toMatchObject({ tagline: true, summary: false, category: false, tags: false, features: false, useCases: false })
  })

  it('does not lock on a re-save without changes', async () => {
    await asAdmin({ ai: { summary: 'AI text', tagline: 'AI tagline', features: ['a', 'b'] }, _h_tags: [tax.seo.id, tax.s3.id] })
    expect(await locksOf()).toMatchObject({ summary: false, tagline: false, features: false, tags: false })
  })

  it('does not lock system writes', async () => {
    await payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: true, data: { ai: { summary: 'Sync/AI rewrite', tagline: 'AI tagline' } } })
    await payload.update({
      collection: 'plugins',
      id: plugin.id,
      overrideAccess: true,
      context: { enrichment: true },
      data: { ai: { tagline: 'Enriched' }, category: tax.cloud.id },
    })
    expect(await locksOf()).toMatchObject({ summary: false, tagline: false, category: false })
  })

  it('does not lock an admin-user write carrying the enrichment context', async () => {
    await payload.update({
      collection: 'plugins',
      id: plugin.id,
      overrideAccess: true,
      user: admin as never,
      context: { enrichment: true },
      data: { ai: { tagline: 'Enriched' } },
    })
    expect(await locksOf()).toMatchObject({ tagline: false })
  })

  it('does not lock when an admin only reorders tags', async () => {
    await asAdmin({ _h_tags: [tax.s3.id, tax.seo.id] })
    expect((await locksOf())?.tags).toBe(false)
  })

  it('locks tags when the tag set changes', async () => {
    await asAdmin({ _h_tags: [tax.s3.id] })
    expect((await locksOf())?.tags).toBe(true)
  })

  it('lets an admin unlock a field without re-locking it', async () => {
    await asAdmin({ ai: { summary: 'Mine', tagline: 'AI tagline' } })
    expect((await locksOf())?.summary).toBe(true)
    await asAdmin({ locks: { summary: false } })
    expect((await locksOf())?.summary).toBe(false)
  })

  it('respects an explicit unlock made in the same save as an edit', async () => {
    await asAdmin({ ai: { summary: 'Mine' } })
    await asAdmin({ ai: { summary: 'Mine again' }, locks: { summary: false } })
    expect((await locksOf())?.summary).toBe(false)
  })
})
