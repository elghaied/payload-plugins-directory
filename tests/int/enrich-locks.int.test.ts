import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { runEnrich } from '@/enrich/enrichPlugin'
import type { Plugin } from '@/payload-types'
import { fakeEnrichClient, okMessage } from '../helpers/fakeEnrichClient'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy, goodOutput } from './helpers/taxonomy'

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

  it('normalises an empty form field to null: no spurious lock', async () => {
    await payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: true, data: { ai: { tagline: null, summary: null } } })
    await asAdmin({ ai: { tagline: '', summary: '' } })
    expect(await locksOf()).toMatchObject({ tagline: false, summary: false })
  })
})

describe('final fix A2: a stale admin form save', () => {
  /** What the edit form submits: every field, without the system columns. */
  const formFields = (doc: Plugin) => {
    const fields: Partial<Plugin> = { ...doc }
    delete fields.id
    delete fields.createdAt
    delete fields.updatedAt
    return fields
  }
  const NOW = new Date('2026-10-19T12:00:00Z')
  const reload = () => payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: true, depth: 0 })

  it('keeps the AI output of an enrichment that landed after the form loaded, sets no locks, still saves other fields', async () => {
    await payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: true, data: { contentHash: 'h1' } })
    // The admin opens the edit form: the full document as the admin reads it.
    const form = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: false, user: admin as never, depth: 0 })
    const r = await runEnrich(payload, plugin.id, fakeEnrichClient(() => okMessage(goodOutput())), () => NOW)
    expect(r.status).toBe('applied')
    const enriched = await reload()

    const fields = formFields(form)
    await asAdmin({ ...fields, visibility: 'hidden' })

    const after = await reload()
    expect(after.visibility).toBe('hidden')
    expect(after.category).toBe(tax.cloud.id)
    expect(after._h_tags).toEqual(enriched._h_tags)
    expect(after.ai).toMatchObject({
      tagline: 'Store Payload uploads in Amazon S3',
      summary: enriched.ai?.summary,
      features: enriched.ai?.features,
      useCases: enriched.ai?.useCases,
      enrichedAt: NOW.toISOString(),
      enrichedHash: 'h1',
      promptHash: enriched.ai?.promptHash,
      confidence: 0.9,
      model: 'claude-sonnet-5-5',
    })
    expect(after.locks).toMatchObject({ category: false, tags: false, tagline: false, summary: false, features: false, useCases: false })
  })

  it('a form loaded after the enrichment still locks what the admin edits', async () => {
    await payload.update({ collection: 'plugins', id: plugin.id, overrideAccess: true, data: { contentHash: 'h1' } })
    await runEnrich(payload, plugin.id, fakeEnrichClient(() => okMessage(goodOutput())), () => NOW)
    const form = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: false, user: admin as never, depth: 0 })
    const fields = formFields(form)
    await asAdmin({ ...fields, ai: { ...fields.ai, summary: 'Fixed by hand' } })
    expect(await locksOf()).toMatchObject({ summary: true, tagline: false, category: false, tags: false })
    expect((await reload()).ai?.summary).toBe('Fixed by hand')
  })

  it('R2: an admin save never writes the machine-owned failure fields', async () => {
    await payload.update({
      collection: 'plugins', id: plugin.id, overrideAccess: true,
      data: { ai: { failure: 'refusal:cyber', failedAt: '2026-10-19T12:00:00.000Z', failedKey: 'h:f' } },
    })
    const form = await payload.findByID({ collection: 'plugins', id: plugin.id, overrideAccess: false, user: admin as never, depth: 0 })
    // A form loaded before the failure was recorded echoes the old (empty) values, with nothing else stale.
    await asAdmin({ ai: { ...form.ai, failure: null, failedAt: null, failedKey: null }, visibility: 'hidden' })
    const after = await reload()
    expect(after.visibility).toBe('hidden')
    expect(after.ai).toMatchObject({ failure: 'refusal:cyber', failedAt: '2026-10-19T12:00:00.000Z', failedKey: 'h:f' })
    expect(after.locks).toMatchObject({ tagline: false, summary: false, features: false })
  })
})
