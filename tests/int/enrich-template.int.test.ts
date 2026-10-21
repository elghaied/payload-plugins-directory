import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { eq } from '@payloadcms/db-postgres/drizzle'
import { jobStatus } from '@/db/jobStatus'
import { INFLIGHT_KEY, lastTaxonomyEdit, readInflight } from '@/enrich/batch'
import { failureKey } from '@/enrich/context'
import { loadTemplateEnrichContext } from '@/enrich/templates/context'
import { runEnrichTemplate, runTemplateEnrichAll } from '@/enrich/templates/run'
import type { Template } from '@/payload-types'
import { setSyncDeps } from '@/sync/deps'
import { seedTemplateCategories } from '@/taxonomy/templateSeed'
import { fakeEnrichClient, okMessage, refusalMessage, type FakeEnrichClient } from '../helpers/fakeEnrichClient'
import { fakeFetch } from '../helpers/fakeFetch'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy, goodOutput } from './helpers/taxonomy'

let payload: Payload
let template: Template
let repoId: number
const NOW = new Date(Date.now() + 2 * 3_600_000) // past the taxonomy-edit debounce
const now = () => NOW
const env = { internalWebUrl: 'http://web.test', revalidateSecret: 's3cret' }
const answer = (over: Record<string, unknown> = {}) =>
  fakeEnrichClient((req) => okMessage(goodOutput({ category: 'landing-pages', ...over }), { model: req.model }))
const reload = (id: number) => payload.findByID({ collection: 'templates', id, overrideAccess: true, depth: 1 })
const jobsOf = async (task: string) =>
  (await payload.find({ collection: 'payload-jobs', overrideAccess: true, sort: 'createdAt', limit: 0, pagination: false, where: { taskSlug: { equals: task } } })).docs
const status = async (key: string) => (await payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, key)))[0]

let n = 0
async function createTemplate(over: Partial<Template> = {}): Promise<Template> {
  n++
  return payload.create({
    collection: 'templates',
    overrideAccess: true,
    depth: 0,
    context: { skipRevalidate: true },
    data: {
      slug: `tpl-${n}`, name: `Template ${n}`, repository: repoId, url: `https://github.com/acme/tpl-${n}`, source: 'submission',
      contentHash: `hash-${n}`, description: 'A landing page starter', readme: '# Landing\nA marketing site.', stackDetected: 'nextjs',
      dependencyNames: ['@payloadcms/next', 'payload'], payloadVersionRange: '^3.0.0',
      ...over,
    } as never,
  })
}

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await createTestTaxonomy(payload) // plugin categories + the s3/seo tags goodOutput uses
  await seedTemplateCategories(payload)
  repoId = (await createRepo(payload, { topics: ['payload-template', 'aws-s3'] })).id
  template = await createTemplate({ slug: 'acme-landing', contentHash: 'hash-1' })
})
afterEach(() => {
  setSyncDeps(null)
  vi.restoreAllMocks()
})
afterAll(async () => resetDatabase(payload))

describe('runEnrichTemplate', () => {
  it('applies the template category, tagline, summary, features and use cases', async () => {
    const fake = answer()
    const r = await runEnrichTemplate(payload, template.id, fake, now)
    expect(r).toMatchObject({ status: 'applied', model: 'claude-sonnet-5-5', usage: { input: 6000, output: 800, cacheRead: 2500 } })
    expect(r.revalidateTags).toEqual(['templates', 'template:acme-landing', 'template-category:landing-pages'])

    const [req] = fake.calls
    expect(req.system[0].text).toContain('starter templates for the Payload Directory')
    expect(req.system[0].text).toContain('- landing-pages: Landing pages')
    expect(req.system[0].text).not.toContain('- cloud-storage:') // plugin categories never reach the template prompt
    expect(req.messages[0].content).toContain('<template_data>')
    expect(req.messages[0].content).toContain('<stack>\nnextjs\n</stack>')
    expect(req.messages[0].content).toContain('<dependencies>\n@payloadcms/next, payload\n</dependencies>')

    const doc = await reload(template.id)
    const { fingerprint } = await loadTemplateEnrichContext(payload)
    expect(typeof doc.category === 'object' && doc.category?.slug).toBe('landing-pages')
    expect(doc.ai).toMatchObject({
      tagline: 'Store Payload uploads in Amazon S3',
      summary: goodOutput().summary,
      features: goodOutput().features,
      useCases: goodOutput().useCases,
      confidence: 0.9, enrichedHash: 'hash-1', promptHash: fingerprint, enrichedAt: NOW.toISOString(),
    })
    expect(doc.ai?.failure ?? null).toBeNull()
    // AI tag s3 and new tag, plus the alias tag of the repository topic aws-s3 (also s3).
    const tagSlugs = ((doc._h_tags ?? []) as { slug: string }[]).map((t) => t.slug).sort()
    expect(tagSlugs).toEqual(['presigned-uploads', 's3'])
  })

  it('keeps a locked summary', async () => {
    await payload.update({
      collection: 'templates', id: template.id, overrideAccess: true, context: { skipRevalidate: true },
      data: { ai: { summary: 'Curated summary.' }, locks: { summary: true } },
    })
    expect((await runEnrichTemplate(payload, template.id, answer(), now)).status).toBe('applied')
    const doc = await reload(template.id)
    expect(doc.ai?.summary).toBe('Curated summary.')
    expect(doc.ai?.tagline).toBe('Store Payload uploads in Amazon S3')
  })

  it('drops an answer for an older contentHash as stale', async () => {
    const fake = fakeEnrichClient(async (req) => {
      await payload.update({ collection: 'templates', id: template.id, overrideAccess: true, context: { skipRevalidate: true }, data: { contentHash: 'hash-2' } })
      return okMessage(goodOutput({ category: 'landing-pages' }), { model: req.model })
    })
    const r = await runEnrichTemplate(payload, template.id, fake, now)
    expect(r.status).toBe('stale')
    expect((await reload(template.id)).ai?.enrichedHash ?? null).toBeNull()
  })

  it('records a refusal as ai.failure with the failure key', async () => {
    const r = await runEnrichTemplate(payload, template.id, fakeEnrichClient(() => refusalMessage()), now)
    expect(r.status).toBe('failed')
    const doc = await reload(template.id)
    const { fingerprint } = await loadTemplateEnrichContext(payload)
    expect(doc.ai?.failure).toMatch(/refus/)
    expect(doc.ai?.failedKey).toBe(failureKey('hash-1', fingerprint))
    expect(doc.ai?.tagline ?? null).toBeNull()
  })

  it('records an apply error as apply-error:* and never rethrows', async () => {
    vi.spyOn(payload.logger, 'error').mockImplementation(() => undefined)
    const original = payload.update.bind(payload)
    let first = true
    vi.spyOn(payload, 'update').mockImplementation(((args: Parameters<typeof payload.update>[0]) => {
      if (first && args.collection === 'templates') {
        first = false
        throw new TypeError('boom')
      }
      return original(args)
    }) as typeof payload.update)
    const r = await runEnrichTemplate(payload, template.id, answer(), now)
    expect(r).toMatchObject({ status: 'failed', reason: 'apply-error:TypeError' })
    vi.restoreAllMocks()
    expect((await reload(template.id)).ai?.failure).toBe('apply-error:TypeError')
  })

  it('skips without calling the API when there is no client', async () => {
    expect((await runEnrichTemplate(payload, template.id, null, now)).status).toBe('no-api-key')
  })
})

describe('runTemplateEnrichAll', () => {
  it('returns the stale template ids, official first, and skips one whose failedKey matches', async () => {
    const official = await createTemplate({ slug: 'website', isOfficial: true, source: 'official' })
    const failed = await createTemplate({ slug: 'failed-one', contentHash: 'hash-f' })
    const { fingerprint } = await loadTemplateEnrichContext(payload)
    await payload.update({
      collection: 'templates', id: failed.id, overrideAccess: true, context: { skipRevalidate: true, enrichment: true },
      data: { ai: { failure: 'refusal', failedKey: failureKey('hash-f', fingerprint) } },
    })
    const fake = fakeEnrichClient()
    const r = await runTemplateEnrichAll(payload, fake, NOW)
    expect(r).toEqual({ status: 'direct', ids: [official.id, template.id] })
    expect(fake.calls).toHaveLength(0)
  })

  it('returns no-api-key without a client and makes no call', async () => {
    expect(await runTemplateEnrichAll(payload, null, NOW)).toEqual({ status: 'no-api-key', ids: [] })
  })

  it('is debounced by a recent template-category edit unless forced', async () => {
    const before = await lastTaxonomyEdit(payload)
    await new Promise((r) => setTimeout(r, 5))
    const cat = (await payload.find({ collection: 'template-categories', overrideAccess: true, where: { slug: { equals: 'portfolios' } } })).docs[0]
    const edited = await payload.update({ collection: 'template-categories', id: cat.id, overrideAccess: true, context: { skipRevalidate: true }, data: { title: 'Portfolios' } })
    expect(await lastTaxonomyEdit(payload)).toBe(Date.parse(edited.updatedAt))
    expect(Date.parse(edited.updatedAt)).toBeGreaterThan(before)
    const r = await runTemplateEnrichAll(payload, fakeEnrichClient(), new Date())
    expect(r.status).toBe('debounced')
    expect((await runTemplateEnrichAll(payload, fakeEnrichClient(), new Date(), { force: true })).status).toBe('direct')
  })

  it('reports nothing-stale once every template is enriched', async () => {
    await runEnrichTemplate(payload, template.id, answer(), now)
    expect(await runTemplateEnrichAll(payload, fakeEnrichClient(), NOW)).toEqual({ status: 'nothing-stale', ids: [] })
  })
})

describe('enrich-all and enrich-template jobs', () => {
  const setDeps = (enrichClient: FakeEnrichClient | null) =>
    setSyncDeps({ fetch: fakeFetch({}), now: () => NOW, env, enrichClient })

  it('the enrich-all handler queues enrich-template jobs even while a plugin batch is in flight', async () => {
    const repo = await createRepo(payload)
    await createPlugin(payload, repo.id, { slug: 'p1', contentHash: 'h1' })
    await payload.db.drizzle.insert(jobStatus).values({
      key: INFLIGHT_KEY,
      details: { state: 'submitted', at: NOW.toISOString(), claim: 'c1', batchId: 'msgbatch_x' },
      lastSuccessAt: NOW,
      updatedAt: NOW,
    })
    setDeps(fakeEnrichClient())
    await payload.jobs.queue({ task: 'enrich-all', input: {}, queue: 'default', overrideAccess: true })
    await payload.jobs.run({ queue: 'default', overrideAccess: true })
    expect(await status('enrich-all')).toMatchObject({ details: { status: 'batch-in-flight', queued: 0, templatesQueued: 1 } })
    expect((await jobsOf('enrich-template')).map((j) => j.input)).toEqual([{ templateId: template.id }])
    expect(await jobsOf('enrich')).toEqual([])
    expect(await readInflight(payload)).toMatchObject({ batchId: 'msgbatch_x' })
  })

  it('an enrich-template job enriches the template and queues its revalidation', async () => {
    setDeps(answer())
    await payload.jobs.queue({ task: 'enrich-template', input: { templateId: template.id }, queue: 'enrich', overrideAccess: true })
    await payload.jobs.run({ queue: 'enrich', overrideAccess: true })
    expect((await reload(template.id)).ai?.enrichedHash).toBe('hash-1')
    expect((await jobsOf('revalidate')).map((j) => j.input)).toEqual([
      { tags: ['templates', 'template:acme-landing', 'template-category:landing-pages'] },
    ])
    expect(await status('enrich-template')).toMatchObject({ details: { status: 'applied', inputTokens: 6000 } })
  })
})
