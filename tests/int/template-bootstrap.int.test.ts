import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import { queueFirstTemplateDiscovery } from '@/sync/templates/bootstrap'
import { createRepo, createTemplate } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { createTestTaxonomy } from './helpers/taxonomy'

let payload: Payload

const discoverJobs = async () =>
  (await payload.count({ collection: 'payload-jobs', overrideAccess: true, where: { taskSlug: { equals: 'discover-templates' } } })).totalDocs

beforeEach(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await createTestTaxonomy(payload)
})
afterAll(async () => resetDatabase(payload))

describe('queueFirstTemplateDiscovery', () => {
  it('queues one discover-templates job when there are no templates, and not a second while it is pending', async () => {
    expect(await queueFirstTemplateDiscovery(payload)).toBe(true)
    expect(await queueFirstTemplateDiscovery(payload)).toBe(false)
    expect(await discoverJobs()).toBe(1)
  })

  it('still queues when the only pending discovery is a scheduled one hours away', async () => {
    const later = new Date(Date.now() + 5 * 60 * 60 * 1000)
    await payload.jobs.queue({ task: 'discover-templates', input: {}, queue: 'default', waitUntil: later, meta: { scheduled: true }, overrideAccess: true })
    expect(await queueFirstTemplateDiscovery(payload)).toBe(true)
    expect(await queueFirstTemplateDiscovery(payload)).toBe(false)
    expect(await discoverJobs()).toBe(2)
  })

  it('does nothing once any template exists, even a trashed one', async () => {
    const repo = await createRepo(payload)
    const t = await createTemplate(payload, repo.id)
    await payload.update({ collection: 'templates', id: t.id, overrideAccess: true, context: { skipRevalidate: true }, data: { deletedAt: new Date().toISOString() } })
    expect(await queueFirstTemplateDiscovery(payload)).toBe(false)
    expect(await discoverJobs()).toBe(0)
  })
})
