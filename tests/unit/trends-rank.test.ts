import { describe, expect, it } from 'vitest'
import type { Point } from '@/lib/trends/growth'
import { newThisMonth, rankDownloadGrowth, rankStarGrowth, recentlyUpdated } from '@/lib/trends/rank'
import { toListedRef } from '@/lib/trends/refs'
import type { ListedPluginRef } from '@/lib/trends/types'

type Repo = ListedPluginRef['repository']
const repo = (id: number, fullName: string, extra: Partial<Repo> = {}): Repo => ({
  id, fullName, owner: fullName.split('/')[0], ownerAvatar: `https://a/${id}`, pushedAt: null,
  githubCreatedAt: '2020-01-01T00:00:00Z', ...extra,
})
const ref = (id: number, slug: string, r: Repo, extra: Partial<ListedPluginRef> = {}): ListedPluginRef => ({
  id, slug, name: slug, isOfficial: false, firstSeenAt: '2026-08-01T10:00:00Z', repository: r, ...extra,
})
const asOf = '2026-10-19'
const week = (start: number, end: number): Point[] => [{ date: '2026-10-12', value: start }, { date: asOf, value: end }]

describe('toListedRef', () => {
  it('maps a depth-1 plugin doc and refuses an unpopulated repository', () => {
    const doc = {
      id: 7, slug: 's', name: 'n', isOfficial: true, firstSeenAt: '2026-10-01T00:00:00.000Z',
      repository: { id: 3, fullName: 'o/r', owner: 'o', ownerAvatar: null, pushedAt: null, githubCreatedAt: '2024-01-01T00:00:00.000Z' },
    }
    expect(toListedRef(doc as never)).toEqual({
      id: 7, slug: 's', name: 'n', isOfficial: true, firstSeenAt: '2026-10-01T00:00:00.000Z',
      repository: { id: 3, fullName: 'o/r', owner: 'o', ownerAvatar: '', pushedAt: null, githubCreatedAt: '2024-01-01T00:00:00.000Z' },
    })
    expect(() => toListedRef({ ...doc, repository: 3 } as never)).toThrow(/depth/)
  })
})

describe('rankStarGrowth', () => {
  it('lists a monorepo once, with all of its listed plugins', () => {
    const mono = repo(1, 'payloadcms/payload')
    const refs = [ref(10, 'seo', mono), ref(11, 'form-builder', mono), ref(12, 'b', repo(2, 'a/b'))]
    const res = rankStarGrowth(refs, new Map([[1, week(100, 150)], [2, week(10, 30)]]), asOf)
    expect(res.map((m) => m.fullName)).toEqual(['payloadcms/payload', 'a/b'])
    expect(res[0].plugins.map((p) => p.slug)).toEqual(['form-builder', 'seo'])
    expect(res[0].growth.delta).toBe(50)
  })
  it('ignores repositories without a listed plugin, without growth, or without a baseline', () => {
    const refs = [ref(12, 'b', repo(2, 'a/b')), ref(13, 'c', repo(3, 'a/c'))]
    const series = new Map<number, Point[]>([
      [2, week(10, 10)], // no growth
      [3, [{ date: asOf, value: 99 }]], // one day only
      [4, week(0, 9999)], // repo 4 backs no listed plugin
    ])
    expect(rankStarGrowth(refs, series, asOf)).toEqual([])
  })
  it('returns nothing when there is no snapshot day at all', () => {
    expect(rankStarGrowth([ref(1, 'x', repo(1, 'o/x'))], new Map(), null)).toEqual([])
  })
  it('breaks ties by percentage, then by name, and honours the limit', () => {
    const refs = [ref(3, 'z', repo(3, 'o/z')), ref(2, 'y', repo(2, 'o/y')), ref(1, 'x', repo(1, 'o/x'))]
    const series = new Map([[1, week(100, 110)], [2, week(10, 20)], [3, week(10, 20)]])
    expect(rankStarGrowth(refs, series, asOf, 2).map((m) => m.fullName)).toEqual(['o/y', 'o/z'])
  })
})

describe('growth floor and shrinkage', () => {
  it('excludes +1 entries and negative growth from both lists', () => {
    const refs = [ref(1, 'a', repo(1, 'o/a')), ref(2, 'b', repo(2, 'o/b')), ref(3, 'c', repo(3, 'o/c'))]
    const series = new Map([[1, week(10, 11)], [2, week(10, 12)], [3, week(10, 5)]])
    expect(rankStarGrowth(refs, series, asOf).map((m) => m.fullName)).toEqual(['o/b'])
    expect(rankDownloadGrowth(refs, series, asOf).map((m) => m.slug)).toEqual(['b'])
  })
  it('breaks a full tie by slug, not input order', () => {
    const r = repo(1, 'o/r')
    const refs = [ref(2, 'zed', r, { name: 'same' }), ref(1, 'abc', r, { name: 'same' })]
    expect(rankDownloadGrowth(refs, new Map([[1, week(1, 11)], [2, week(1, 11)]]), asOf).map((m) => m.slug)).toEqual(['abc', 'zed'])
  })
})

describe('rankDownloadGrowth', () => {
  it('ranks plugins by weekly-download gain', () => {
    const r = repo(1, 'o/r')
    const refs = [ref(1, 'a', r), ref(2, 'b', r), ref(3, 'c', r)]
    const res = rankDownloadGrowth(refs, new Map([[1, week(100, 150)], [2, week(100, 400)]]), asOf)
    expect(res.map((m) => m.slug)).toEqual(['b', 'a'])
    expect(res[0]).toMatchObject({ pluginId: 2, owner: 'o', growth: { delta: 300 } })
  })
  it('skips shrinking plugins and plugins without series', () => {
    const refs = [ref(1, 'a', repo(1, 'o/r')), ref(2, 'b', repo(1, 'o/r'))]
    expect(rankDownloadGrowth(refs, new Map([[1, week(500, 400)]]), asOf)).toEqual([])
  })
})

describe('newThisMonth', () => {
  const today = '2026-10-19'
  it('does not treat the initial seed as new', () => {
    const refs = [ref(1, 'a', repo(1, 'o/a'), { firstSeenAt: '2026-10-05T10:00:00Z' }), ref(2, 'b', repo(2, 'o/b'), { firstSeenAt: '2026-10-05T10:01:00Z' })]
    expect(newThisMonth(refs, today)).toEqual([])
  })
  it('lists plugins first listed after the seed day', () => {
    const refs = [ref(1, 'a', repo(1, 'o/a')), ref(2, 'b', repo(2, 'o/b'), { firstSeenAt: '2026-10-15T09:00:00Z' })]
    expect(newThisMonth(refs, today)).toEqual([
      { slug: 'b', name: 'b', owner: 'o', ownerAvatar: 'https://a/2', addedOn: '2026-10-15', reason: 'newly-listed' },
    ])
  })
  it('uses UTC days at the boundary', () => {
    const refs = [ref(1, 'a', repo(1, 'o/a')), ref(2, 'b', repo(2, 'o/b'), { firstSeenAt: '2026-10-15T23:30:00-05:00' })]
    expect(newThisMonth(refs, today)[0].addedOn).toBe('2026-10-16')
  })
  it('lists brand-new repositories even when seeded, within 30 days only', () => {
    const refs = [
      ref(1, 'a', repo(1, 'o/a', { githubCreatedAt: '2026-09-19T12:00:00Z' })), // 30 days ago
      ref(2, 'b', repo(2, 'o/b', { githubCreatedAt: '2026-09-18T12:00:00Z' })), // 31 days ago
    ]
    expect(newThisMonth(refs, today).map((n) => [n.slug, n.reason])).toEqual([['a', 'new-repository']])
  })
  it('breaks same-day ties by name then slug, regardless of input order', () => {
    const mk = (id: number, slug: string, name: string) =>
      ref(id, slug, repo(id, `o/r${id}`), { name, firstSeenAt: '2026-10-15T00:00:00Z' })
    const refs = [mk(4, 'z2', 'Same'), mk(3, 'a1', 'Same'), mk(2, 'b', 'Beta'), ref(1, 'base', repo(1, 'o/base'))]
    expect(newThisMonth(refs, '2026-10-19').map((n) => n.slug)).toEqual(['b', 'a1', 'z2'])
  })
  it('sorts newest first', () => {
    const refs = [
      ref(1, 'base', repo(1, 'o/base')),
      ref(2, 'older', repo(2, 'o/x'), { firstSeenAt: '2026-10-02T00:00:00Z' }),
      ref(3, 'newer', repo(3, 'o/y'), { firstSeenAt: '2026-10-18T00:00:00Z' }),
    ]
    expect(newThisMonth(refs, today).map((n) => n.slug)).toEqual(['newer', 'older'])
  })
})

describe('recentlyUpdated', () => {
  it('lists each repository once, newest push first, skipping unknown push dates', () => {
    const mono = repo(1, 'payloadcms/payload', { pushedAt: '2026-10-19T08:00:00Z' })
    const refs = [
      ref(1, 'seo', mono),
      ref(2, 'form-builder', mono),
      ref(3, 'x', repo(2, 'o/x', { pushedAt: '2026-10-18T08:00:00Z' })),
      ref(4, 'y', repo(3, 'o/y', { pushedAt: null })),
    ]
    const res = recentlyUpdated(refs)
    expect(res.map((r) => r.fullName)).toEqual(['payloadcms/payload', 'o/x'])
    expect(res[0].plugins.map((p) => p.slug)).toEqual(['form-builder', 'seo'])
  })
  it('honours the limit', () => {
    const refs = [1, 2, 3].map((i) => ref(i, `p${i}`, repo(i, `o/p${i}`, { pushedAt: `2026-10-1${i}T00:00:00Z` })))
    expect(recentlyUpdated(refs, 2).map((r) => r.fullName)).toEqual(['o/p3', 'o/p2'])
  })
})

describe('newThisMonth bulk imports', () => {
  it('ignores a bulk-import day that straddles the seed (300 on D, 40 on D+1)', () => {
    const seed = Array.from({ length: 300 }, (_, i) => ref(i, `s${i}`, repo(i, `o/s${i}`), { firstSeenAt: '2026-10-10T23:59:00Z' }))
    const spill = Array.from({ length: 40 }, (_, i) => ref(1000 + i, `t${i}`, repo(1000 + i, `o/t${i}`), { firstSeenAt: '2026-10-11T00:01:00Z' }))
    expect(newThisMonth([...seed, ...spill], asOf)).toEqual([])
  })
  it('still lists a normal day with 3 new plugins after a large seed', () => {
    const seed = Array.from({ length: 300 }, (_, i) => ref(i, `s${i}`, repo(i, `o/s${i}`), { firstSeenAt: '2026-10-10T12:00:00Z' }))
    const fresh = [1, 2, 3].map((i) => ref(1000 + i, `n${i}`, repo(1000 + i, `o/n${i}`), { firstSeenAt: '2026-10-15T12:00:00Z' }))
    expect(newThisMonth([...seed, ...fresh], asOf).map((n) => n.slug)).toEqual(['n1', 'n2', 'n3'])
  })
})
