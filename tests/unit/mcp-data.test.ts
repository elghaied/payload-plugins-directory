import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Payload } from 'payload'

const summaries = vi.hoisted(() => vi.fn())
vi.mock('@/lib/directory/queries', () => ({ getPluginSummaries: summaries }))

import { listCategoriesWithCounts } from '@/mcp/data'

const cat = (id: number, slug: string, extra: Record<string, unknown> = {}) => ({ id, slug, title: slug.toUpperCase(), intro: null, parent: null, _h_slugPath: slug, ...extra })

function fakePayload(categories: unknown[]) {
  const find = vi.fn(async ({ collection }: { collection: string }) => {
    if (collection !== 'categories') throw new Error(`listCategories must not read ${collection}`)
    return { docs: categories }
  })
  const error = vi.fn()
  return { payload: { find, logger: { error } } as unknown as Payload, find, error }
}

beforeEach(() => summaries.mockReset())

describe('listCategoriesWithCounts', () => {
  it('derives direct counts from the cached plugin summaries, never reading plugins itself', async () => {
    summaries.mockResolvedValue([{ categoryPath: 'a' }, { categoryPath: 'a' }, { categoryPath: 'a/b' }, {}])
    const { payload, find } = fakePayload([cat(1, 'a'), cat(2, 'b', { parent: 1, _h_slugPath: 'a/b' })])
    const out = await listCategoriesWithCounts(payload)
    expect(out.map((c) => [c.path, c.pluginCount])).toEqual([['a', 2], ['a/b', 1]])
    expect(find).toHaveBeenCalledTimes(1)
  })
  it('skips and logs one category without _h_slugPath instead of failing the whole tool', async () => {
    summaries.mockResolvedValue([])
    const { payload, error } = fakePayload([cat(1, 'a'), cat(2, 'broken', { _h_slugPath: undefined }), cat(3, 'c')])
    const out = await listCategoriesWithCounts(payload)
    expect(out.map((c) => c.slug)).toEqual(['a', 'c'])
    expect(error).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(error.mock.calls[0])).toContain('broken')
  })
})
