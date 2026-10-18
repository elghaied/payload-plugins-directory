import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Payload } from 'payload'
import fixture from '../fixtures/legacy-plugins.json'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'
import { seedDirectory } from '@/cli/seed'

let payload: Payload
const input = mapLegacy(fixture as LegacyPluginsData, ['684372049-translator'])

beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('seedDirectory', () => {
  it('creates repositories and plugins', async () => {
    const result = await seedDirectory(payload, input)
    expect(result).toEqual({ repositoriesCreated: 3, pluginsCreated: 4, pluginsUpdated: 0 })
    const plugin = await payload.find({
      collection: 'plugins',
      overrideAccess: true,
      where: { slug: { equals: '684372049-better-localized-fields' } },
      depth: 1,
    })
    expect((plugin.docs[0].repository as { fullName: string }).fullName).toBe('r1tsuu/payload-enchants')
  })

  it('is idempotent on re-run', async () => {
    const result = await seedDirectory(payload, input)
    expect(result).toEqual({ repositoriesCreated: 0, pluginsCreated: 0, pluginsUpdated: 4 })
    const count = await payload.count({ collection: 'plugins', overrideAccess: true })
    expect(count.totalDocs).toBe(4)
  })
})
