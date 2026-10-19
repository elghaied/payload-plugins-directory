import { addDays, asDay, daysBetween, type Day } from './days'

export type Point = { date: Day; value: number }
export type Growth = { from: Point; to: Point; delta: number; pct: number | null }
export type Coverage = { daysCollected: number; firstDay: Day | null; lastDay: Day | null; spanDays: number; ready: boolean }

/** "This week" = the value on asOf compared with the value 7 UTC days earlier. */
export const TREND_WINDOW_DAYS = 7
/** If the baseline day is missing (a failed snapshot run), accept up to this many days earlier. */
export const BASELINE_TOLERANCE_DAYS = 2
/** History shown in charts. */
export const HISTORY_DAYS = 90

const byDate = (a: { date: Day }, b: { date: Day }) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)

export function growthOverWindow(
  series: Point[],
  asOf: Day,
  windowDays = TREND_WINDOW_DAYS,
  tolerance = BASELINE_TOLERANCE_DAYS,
): Growth | null {
  const index = new Map(series.map((p) => [p.date, p]))
  const to = index.get(asOf)
  if (!to) return null
  for (let back = 0; back <= tolerance; back++) {
    const from = index.get(addDays(asOf, -(windowDays + back)))
    if (from) {
      const delta = to.value - from.value
      return { from, to, delta, pct: from.value > 0 ? delta / from.value : null }
    }
  }
  return null
}

/** How much history exists. `ready` = first and last snapshot are at least a full window apart. */
export function coverage(days: Day[], windowDays = TREND_WINDOW_DAYS): Coverage {
  const distinct = [...new Set(days)].sort()
  if (distinct.length === 0) return { daysCollected: 0, firstDay: null, lastDay: null, spanDays: 0, ready: false }
  const firstDay = distinct[0]
  const lastDay = distinct[distinct.length - 1]
  const spanDays = daysBetween(firstDay, lastDay)
  return { daysCollected: distinct.length, firstDay, lastDay, spanDays, ready: spanDays >= windowDays }
}

export function groupSeries(rows: { id: number; date: unknown; value: number | null }[]): Map<number, Point[]> {
  const out = new Map<number, Point[]>()
  for (const row of rows) {
    if (row.value === null || !Number.isFinite(row.value)) continue
    const list = out.get(row.id) ?? []
    list.push({ date: asDay(row.date), value: row.value })
    out.set(row.id, list)
  }
  for (const list of out.values()) list.sort(byDate)
  return out
}

/**
 * Per-day totals from `sum(...) / count(*) group by date` rows. A day where noticeably fewer entities
 * reported than the running peak (a snapshot run that died halfway) is dropped rather than plotted as a dip.
 */
export function ecosystemSeries(
  rows: { date: unknown; total: number | string | null; reporting: number | string }[],
  minShare = 0.9,
): Point[] {
  const sorted = rows
    .map((r) => ({ date: asDay(r.date), total: Number(r.total ?? 0), reporting: Number(r.reporting) }))
    .sort(byDate)
  let peak = 0
  const out: Point[] = []
  for (const r of sorted) {
    peak = Math.max(peak, r.reporting)
    if (r.reporting > 0 && r.reporting >= peak * minShare) out.push({ date: r.date, value: r.total })
  }
  return out
}
