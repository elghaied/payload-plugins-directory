import { describe, expect, it } from 'vitest'
import { rankSimilar, type SimilarityEntry } from '@/lib/directory/similar'

const e = (slug: string, categoryPath?: string, tags: string[] = [], healthScore = 50, weeklyDownloads = 0): SimilarityEntry => ({
  slug, categoryPath, tags, healthScore, weeklyDownloads,
})

describe('rankSimilar', () => {
  const target = e('target', 'a', ['t1', 't2'])
  it('scores category (+2) and each shared tag (+1), excluding self and zero scores', () => {
    const all = [target, e('same-cat', 'a'), e('two-tags', 'b', ['t1', 't2']), e('one-tag', 'b', ['t1']), e('unrelated', 'c', ['x'])]
    expect(rankSimilar(target, all)).toEqual(['same-cat', 'two-tags', 'one-tag'])
  })
  it('breaks ties by health, then downloads, then slug', () => {
    const all = [target, e('b', 'a', [], 50, 5), e('a', 'a', [], 50, 5), e('healthy', 'a', [], 90), e('popular', 'a', [], 50, 100)]
    expect(rankSimilar(target, all)).toEqual(['healthy', 'popular', 'a', 'b'])
  })
  it('is independent of input order', () => {
    const all = [e('x', 'a'), e('y', 'a'), e('z', 'a')]
    expect(rankSimilar(target, all)).toEqual(rankSimilar(target, [...all].reverse()))
  })
  it('respects the limit and returns [] when the target has no taxonomy', () => {
    const all = Array.from({ length: 10 }, (_, i) => e(`p${i}`, 'a'))
    expect(rankSimilar(target, [target, ...all], 3)).toHaveLength(3)
    expect(rankSimilar(e('bare'), all)).toEqual([])
  })
  it('never treats the "other" category as similarity', () => {
    expect(rankSimilar(e('o1', 'other'), [e('o2', 'other'), e('o3', 'other', ['t'])])).toEqual([])
    expect(rankSimilar(e('o1', 'other', ['t']), [e('o2', 'other'), e('o3', 'other', ['t'])])).toEqual(['o3'])
  })
  it('matches nested category paths exactly, not by prefix', () => {
    expect(rankSimilar(e('t', 'auth/oauth'), [e('n', 'auth'), e('m', 'auth/oauth')])).toEqual(['m'])
  })
})
