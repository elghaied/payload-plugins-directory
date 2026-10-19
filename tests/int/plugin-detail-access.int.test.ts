import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'
import { createPlugin, createRepo } from './helpers/directory'
import { getTestPayload, resetDatabase } from './helpers/payload'

// The summary list is served from cache (memoised on first use), as in production between revalidations; every
// other cached query runs live. The detail read must still refuse a slug hidden or trashed since then.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => Promise<unknown>, keyParts: string[]) => {
    if (keyParts[0] !== 'plugin-summaries') return fn
    let memo: Promise<unknown> | undefined
    return (...a: unknown[]) => (memo ??= fn(...a))
  },
}))

let payload: Payload
const ids: Record<string, number> = {}
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
  const repo = await createRepo(payload)
  for (const slug of ['visible', 'hidden-later', 'trashed-later']) ids[slug] = (await createPlugin(payload, repo.id, { slug })).id
})
afterAll(async () => resetDatabase(payload))

describe('getPluginDetail access', () => {
  it('returns null for hidden and trashed slugs, even while the cached summary list still has them', async () => {
    const { getPluginDetail, getPluginSummaries } = await import('@/lib/directory/queries')
    expect((await getPluginSummaries()).map((p) => p.slug).sort()).toEqual(['hidden-later', 'trashed-later', 'visible'])
    await payload.update({ collection: 'plugins', id: ids['hidden-later'], overrideAccess: true, data: { visibility: 'hidden' } })
    await payload.update({ collection: 'plugins', id: ids['trashed-later'], overrideAccess: true, data: { deletedAt: new Date().toISOString() } })
    expect((await getPluginSummaries()).map((p) => p.slug)).toContain('hidden-later') // still the cached list
    expect(await getPluginDetail('hidden-later')).toBeNull()
    expect(await getPluginDetail('trashed-later')).toBeNull()
    expect((await getPluginDetail('visible'))?.slug).toBe('visible')
  })
})
