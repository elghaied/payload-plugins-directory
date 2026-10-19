import { describe, expect, it } from 'vitest'
import { buildChartModel, compactNumber, insufficientMessage, nearestIndex, niceTicks, signed } from '@/lib/trends/chartModel'
import { addDays } from '@/lib/trends/days'
import { coverage } from '@/lib/trends/growth'

const daily = (start: string, values: number[]) => values.map((value, i) => ({ date: addDays(start, i), value }))

describe('number formatting', () => {
  it('compacts and signs values', () => {
    expect(compactNumber(1284)).toBe('1.3K')
    expect(compactNumber(45000)).toBe('45K')
    expect(signed(1284)).toBe('+1.3K')
    expect(signed(-3)).toBe('−3')
    expect(signed(0)).toBe('0')
  })
})

describe('insufficientMessage', () => {
  it('explains that collection has not started', () => {
    expect(insufficientMessage(coverage([]))).toBe('Trends appear after 7 days of data. Daily snapshots have not started yet.')
  })
  it('reports progress with correct plurals', () => {
    expect(insufficientMessage(coverage(['2026-10-19']))).toBe(
      'Trends appear after 7 days of data. Collecting since Oct 19 — 1 daily snapshot so far.',
    )
    expect(insufficientMessage(coverage(['2026-10-17', '2026-10-18', '2026-10-19']))).toBe(
      'Trends appear after 7 days of data. Collecting since Oct 17 — 3 daily snapshots so far.',
    )
  })
})

describe('insufficientMessage at the boundary', () => {
  it('does not contradict itself with 7 snapshots spanning 6 days', () => {
    const days = daily('2026-10-13', [0, 0, 0, 0, 0, 0, 0]).map((p) => p.date)
    const msg = insufficientMessage(coverage(days))
    expect(msg).toBe('Trends appear once the first and last snapshots are 7 days apart. Collecting since Oct 13 — 7 daily snapshots so far.')
  })
})

describe('niceTicks', () => {
  it('produces clean, integer ticks that enclose the data', () => {
    expect(niceTicks(120, 180)).toEqual([120, 140, 160, 180])
    expect(niceTicks(45000, 45210)).toEqual([45000, 45100, 45200, 45300])
    expect(niceTicks(10, 11)).toEqual([10, 11])
  })
  it('handles flat and zero series', () => {
    expect(niceTicks(5, 5)).toEqual([4, 5, 6])
    expect(niceTicks(0, 0)).toEqual([0, 1])
  })
})

describe('nearestIndex', () => {
  it('snaps a pointer position to the closest point', () => {
    expect(nearestIndex([0, 50, 100], 60)).toBe(1)
    expect(nearestIndex([0, 50, 100], 80)).toBe(2)
    expect(nearestIndex([0, 50, 100], -5)).toBe(0)
  })
})

describe('buildChartModel', () => {
  it('is insufficient with no data, one day, or less than a full window', () => {
    expect(buildChartModel([], 'Stars')).toMatchObject({ kind: 'insufficient', message: expect.stringContaining('not started') })
    expect(buildChartModel(daily('2026-10-19', [5]), 'Stars').kind).toBe('insufficient')
    expect(buildChartModel(daily('2026-10-13', [1, 2, 3, 4, 5, 6, 7]), 'Stars').kind).toBe('insufficient')
  })
  it('builds a line and area spanning the full width once a week of data exists', () => {
    const m = buildChartModel(daily('2026-10-12', [45000, 45010, 45020, 45030, 45040, 45050, 45060, 45070]), 'Stars')
    if (m.kind !== 'ready') throw new Error('expected ready')
    expect(m.xs[0]).toBe(0)
    expect(m.xs[m.xs.length - 1]).toBe(100)
    expect(m.ys[0]).toBe(100) // 45000 sits on the lowest tick
    expect(m.line.startsWith('M0 100 L')).toBe(true)
    expect(m.area.endsWith('L100 100 L0 100 Z')).toBe(true)
    expect(m.ticks.map((t) => t.value)).toEqual([45000, 45050, 45100])
    expect(m.delta).toBe(70)
    expect(m.label).toBe('Stars: 45,000 on Oct 12, 2026, 45,070 on Oct 19, 2026 (+70 over 7 days).')
  })
  it('keeps ticks distinct and ordered for huge values', () => {
    const m = buildChartModel(daily('2026-10-12', [0, 1, 2, 3, 4, 5, 6, 7].map((n) => 1e12 + n)), 'Stars')
    if (m.kind !== 'ready') throw new Error('expected ready')
    const v = m.ticks.map((t) => t.value)
    expect(new Set(v).size).toBe(v.length)
    expect(v).toEqual([...v].sort((a, b) => a - b))
    expect(m.ys[m.ys.length - 1]).toBeLessThan(m.ys[0])
  })
  it('handles a flat zero series', () => {
    const m = buildChartModel(daily('2026-10-12', [0, 0, 0, 0, 0, 0, 0, 0]), 'Stars')
    if (m.kind !== 'ready') throw new Error('expected ready')
    expect(m.ticks.map((t) => t.value)).toEqual([0, 1])
    expect(m.ys.every(Number.isFinite)).toBe(true)
  })
  it('places points by date, so gaps stay visible in x', () => {
    const m = buildChartModel([{ date: '2026-10-11', value: 1 }, { date: '2026-10-13', value: 2 }, { date: '2026-10-19', value: 3 }], 'Stars')
    if (m.kind !== 'ready') throw new Error('expected ready')
    expect(m.xs).toEqual([0, 25, 100])
  })
  it('sorts input and keeps the last value for a duplicated day', () => {
    const m = buildChartModel(
      [{ date: '2026-10-19', value: 9 }, { date: '2026-10-12', value: 1 }, { date: '2026-10-19', value: 10 }],
      'Stars',
    )
    if (m.kind !== 'ready') throw new Error('expected ready')
    expect(m.points).toEqual([{ date: '2026-10-12', value: 1 }, { date: '2026-10-19', value: 10 }])
  })
})
