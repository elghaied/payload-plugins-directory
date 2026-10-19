/**
 * A UTC calendar day, 'YYYY-MM-DD'. Snapshot rows are keyed by the UTC day of the snapshot run
 * (spec §4: daily 00:30 UTC). Never derive a Day from local-time getters.
 */
export type Day = string

const DAY_MS = 86_400_000
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

const ms = (day: Day) => Date.parse(`${day}T00:00:00Z`)

export function isDay(value: unknown): value is Day {
  if (typeof value !== 'string' || !DAY_RE.test(value)) return false
  const t = ms(value)
  // Round-trip rejects impossible dates such as 2026-02-31 (V8 would roll them over).
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === value
}

/** UTC calendar day of an instant (ISO timestamp or Date). */
export function utcDay(instant: Date | string): Day {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid instant: ${String(instant)}`)
  return d.toISOString().slice(0, 10)
}

export function utcToday(now: Date = new Date()): Day {
  return utcDay(now)
}

/**
 * Normalises a snapshot `date` column value. Drizzle's `date()` column returns 'YYYY-MM-DD' strings;
 * raw SQL must cast with `::text`. A Date here means a query bypassed that and would shift days.
 */
export function asDay(value: unknown): Day {
  if (isDay(value)) return value
  throw new Error(`Expected a 'YYYY-MM-DD' day, got ${value instanceof Date ? 'a Date object' : JSON.stringify(value)}`)
}

export function addDays(day: Day, n: number): Day {
  return new Date(ms(day) + n * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(from: Day, to: Day): number {
  return Math.round((ms(to) - ms(from)) / DAY_MS)
}

/** Deterministic on server and client (fixed locale + UTC), so hydration never mismatches. */
export function formatDay(day: Day, withYear = false): string {
  return new Date(ms(day)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  })
}
