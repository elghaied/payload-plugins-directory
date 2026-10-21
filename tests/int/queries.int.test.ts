import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import fixture from '../fixtures/legacy-plugins.json'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'
import { seedDirectory } from '@/cli/seed'

const cacheKeys = vi.hoisted(() => [] as string[][])
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown, keyParts: string[]) => {
    cacheKeys.push(keyParts)
    return fn
  },
}))

let payload: Payload
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  await seedDirectory(payload, mapLegacy(fixture as LegacyPluginsData, ['684372049-translator']))
  const trashed = await payload.find({ collection: 'plugins', overrideAccess: true, where: { slug: { equals: '829724738-root' } } })
  // Soft-delete: `payload.delete` hard-deletes in 4.0.0-beta.3 (re-verified), so move to trash via `deletedAt`.
  await payload.update({
    collection: 'plugins',
    id: trashed.docs[0].id,
    overrideAccess: true,
    data: { deletedAt: new Date().toISOString() },
  })
  const stillThere = await payload.count({
    collection: 'plugins',
    overrideAccess: true,
    trash: true,
    where: { slug: { equals: '829724738-root' } },
  })
  if (stillThere.totalDocs !== 1) throw new Error('setup: trashed plugin was not kept in the trash')
})
afterAll(async () => resetDatabase(payload))

describe('directory queries', () => {
  it('lists only listed, non-trashed plugins', async () => {
    const { getPluginSummaries } = await import('@/lib/directory/queries')
    const slugs = (await getPluginSummaries()).map((p) => p.slug).sort()
    expect(slugs).toEqual(['684372049-better-localized-fields', 'official-plugin-form-builder'])
  })
  it('returns null for hidden and trashed plugin details', async () => {
    const { getPluginDetail } = await import('@/lib/directory/queries')
    expect(await getPluginDetail('684372049-translator')).toBeNull()
    expect(await getPluginDetail('829724738-root')).toBeNull()
    expect(await getPluginDetail('does-not-exist')).toBeNull()
  })
  it('does not create per-slug cache entries for unknown, hidden or trashed slugs', async () => {
    const { getPluginDetail } = await import('@/lib/directory/queries')
    cacheKeys.length = 0
    for (const slug of ['does-not-exist', '684372049-translator', '829724738-root']) {
      expect(await getPluginDetail(slug)).toBeNull()
    }
    expect(cacheKeys.filter((k) => k[0] === 'plugin-detail')).toEqual([])
    await getPluginDetail('official-plugin-form-builder')
    expect(cacheKeys.filter((k) => k[0] === 'plugin-detail')).toEqual([['plugin-detail', 'official-plugin-form-builder']])
  })
  it('returns details with readme for listed plugins', async () => {
    const { getPluginDetail } = await import('@/lib/directory/queries')
    const d = await getPluginDetail('official-plugin-form-builder')
    expect(d?.payloadMajors).toEqual(['3'])
    expect(d?.repositoryUrl).toBe('https://github.com/payloadcms/payload')
  })
})
