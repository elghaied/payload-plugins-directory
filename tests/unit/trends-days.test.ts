import { describe, expect, it } from 'vitest'
import { addDays, asDay, daysBetween, formatDay, isDay, utcDay, utcToday } from '@/lib/trends/days'

describe('UTC day helpers', () => {
  it('takes the UTC calendar day of an instant, not the local one', () => {
    expect(utcDay('2026-10-18T23:30:00-05:00')).toBe('2026-10-19')
    expect(utcDay(new Date('2026-10-19T00:10:00Z'))).toBe('2026-10-19')
    expect(utcToday(new Date('2026-12-31T23:59:59Z'))).toBe('2026-12-31')
  })
  it('rejects invalid instants', () => {
    expect(() => utcDay('not a date')).toThrow(/Invalid instant/)
  })
  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(addDays('2026-10-19', -7)).toBe('2026-10-12')
  })
  it('counts whole days between two days', () => {
    expect(daysBetween('2026-10-12', '2026-10-19')).toBe(7)
    expect(daysBetween('2026-10-19', '2026-10-12')).toBe(-7)
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2)
  })
  it('accepts only YYYY-MM-DD strings as snapshot days', () => {
    expect(isDay('2026-10-19')).toBe(true)
    expect(isDay('2026-10-19T00:00:00Z')).toBe(false)
    expect(asDay('2026-10-19')).toBe('2026-10-19')
    // node-postgres turns DATE into a *local-midnight* Date; accepting it would shift days in non-UTC zones.
    expect(() => asDay(new Date('2026-10-19T00:00:00Z'))).toThrow(/YYYY-MM-DD/)
    expect(() => asDay(null)).toThrow(/YYYY-MM-DD/)
  })
  it('formats a day in UTC regardless of the server time zone', () => {
    expect(formatDay('2026-10-19')).toBe('Oct 19')
    expect(formatDay('2026-01-01', true)).toBe('Jan 1, 2026')
  })
})
