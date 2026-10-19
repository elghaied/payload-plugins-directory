import { describe, expect, it } from 'vitest'
import { addDays } from '@/lib/trends/days'
import { coverage, ecosystemSeries, groupSeries, growthOverWindow, type Point } from '@/lib/trends/growth'

const pts = (start: string, values: number[]): Point[] => values.map((value, i) => ({ date: addDays(start, i), value }))

describe('growthOverWindow', () => {
  it('returns null with no data or a single day', () => {
    expect(growthOverWindow([], '2026-10-19')).toBeNull()
    expect(growthOverWindow([{ date: '2026-10-19', value: 5 }], '2026-10-19')).toBeNull()
  })
  it('returns null when the series has no point on asOf', () => {
    expect(growthOverWindow(pts('2026-10-10', [1, 2, 3, 4, 5, 6, 7, 8, 9]), '2026-10-20')).toBeNull()
  })
  it('measures the change over exactly 7 days', () => {
    const g = growthOverWindow(pts('2026-10-12', [100, 101, 102, 103, 104, 105, 106, 120]), '2026-10-19')
    expect(g).toMatchObject({ delta: 20, from: { date: '2026-10-12', value: 100 }, to: { date: '2026-10-19', value: 120 } })
    expect(g?.pct).toBeCloseTo(0.2)
  })
  it('falls back up to 2 days before the baseline day, and no further', () => {
    expect(growthOverWindow([{ date: '2026-10-10', value: 50 }, { date: '2026-10-19', value: 60 }], '2026-10-19')?.from.date).toBe(
      '2026-10-10',
    )
    expect(growthOverWindow([{ date: '2026-10-09', value: 50 }, { date: '2026-10-19', value: 60 }], '2026-10-19')).toBeNull()
  })
  it('reports negative growth, and a null percentage from a zero base', () => {
    expect(growthOverWindow(pts('2026-10-12', [10, 0, 0, 0, 0, 0, 0, 7]), '2026-10-19')?.delta).toBe(-3)
    expect(growthOverWindow(pts('2026-10-12', [0, 0, 0, 0, 0, 0, 0, 7]), '2026-10-19')?.pct).toBeNull()
  })
})

describe('coverage', () => {
  it('reports no data', () => {
    expect(coverage([])).toEqual({ daysCollected: 0, firstDay: null, lastDay: null, spanDays: 0, ready: false })
  })
  it('counts distinct days and is not ready after one day', () => {
    expect(coverage(['2026-10-19', '2026-10-19'])).toEqual({
      daysCollected: 1, firstDay: '2026-10-19', lastDay: '2026-10-19', spanDays: 0, ready: false,
    })
  })
  it('is ready once first and last snapshot are a full window apart', () => {
    const seven = pts('2026-10-13', [0, 0, 0, 0, 0, 0, 0]).map((p) => p.date) // span 6
    const eight = pts('2026-10-12', [0, 0, 0, 0, 0, 0, 0, 0]).map((p) => p.date) // span 7
    expect(coverage(seven).ready).toBe(false)
    expect(coverage(eight)).toMatchObject({ daysCollected: 8, spanDays: 7, ready: true })
  })
})

describe('groupSeries', () => {
  it('groups by id, sorts by day and drops null values', () => {
    const map = groupSeries([
      { id: 1, date: '2026-10-19', value: 3 },
      { id: 1, date: '2026-10-18', value: 2 },
      { id: 2, date: '2026-10-19', value: null },
    ])
    expect(map.get(1)).toEqual([{ date: '2026-10-18', value: 2 }, { date: '2026-10-19', value: 3 }])
    expect(map.has(2)).toBe(false)
  })
  it('refuses Date objects for days', () => {
    expect(() => groupSeries([{ id: 1, date: new Date(), value: 1 }])).toThrow(/YYYY-MM-DD/)
  })
})

describe('ecosystemSeries', () => {
  it('converts aggregate strings to numbers and sorts by day', () => {
    expect(
      ecosystemSeries([
        { date: '2026-10-19', total: '120', reporting: '11' },
        { date: '2026-10-18', total: '100', reporting: '10' },
      ]),
    ).toEqual([{ date: '2026-10-18', value: 100 }, { date: '2026-10-19', value: 120 }])
  })
  it('drops partial snapshot days instead of plotting a fake dip', () => {
    const out = ecosystemSeries([
      { date: '2026-10-17', total: 100, reporting: 10 },
      { date: '2026-10-18', total: 50, reporting: 5 }, // half the entities reported
      { date: '2026-10-19', total: 120, reporting: 10 },
    ])
    expect(out.map((p) => p.date)).toEqual(['2026-10-17', '2026-10-19'])
  })
})
