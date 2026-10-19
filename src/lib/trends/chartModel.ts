import { daysBetween, formatDay } from './days'
import { coverage, TREND_WINDOW_DAYS, type Coverage, type Point } from './growth'

export const MIN_CHART_SPAN_DAYS = TREND_WINDOW_DAYS

const compactFormat = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
export const compactNumber = (n: number) => compactFormat.format(n)
/** Signed compact number; uses U+2212 MINUS SIGN (read as "minus" by screen readers). */
export const signed = (n: number) => (n > 0 ? `+${compactNumber(n)}` : n < 0 ? `−${compactNumber(-n)}` : '0')

export function insufficientMessage(cov: Coverage, needed = MIN_CHART_SPAN_DAYS): string {
  const head = `Trends appear after ${needed} days of data.`
  if (cov.daysCollected === 0 || !cov.firstDay) return `${head} Daily snapshots have not started yet.`
  const n = cov.daysCollected
  if (n >= needed) {
    // Enough snapshots but not a full span (e.g. 7 snapshots over 6 days).
    return `Trends appear once the first and last snapshots are ${needed} days apart. Collecting since ${formatDay(cov.firstDay)} — ${n} daily snapshots so far.`
  }
  return `${head} Collecting since ${formatDay(cov.firstDay)} — ${n} daily ${n === 1 ? 'snapshot' : 'snapshots'} so far.`
}

function niceStep(raw: number): number {
  const exp = 10 ** Math.floor(Math.log10(raw))
  const f = raw / exp
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * exp
}

/** Evenly spaced integer ticks enclosing [min, max]; stars and downloads are counts. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  let lo = min
  let hi = max
  if (hi === lo) {
    hi = lo + 1
    lo = Math.max(0, lo - 1)
  }
  const step = Math.max(1, niceStep((hi - lo) / (count - 1)))
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v))
  return ticks
}

export function nearestIndex(xs: number[], pct: number): number {
  let best = 0
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - pct) < Math.abs(xs[best] - pct)) best = i
  return best
}

export type ChartModel =
  | { kind: 'insufficient'; coverage: Coverage; message: string }
  | {
      kind: 'ready'
      points: Point[]
      xs: number[]
      ys: number[]
      line: string
      area: string
      ticks: { value: number; y: number }[]
      first: Point
      last: Point
      delta: number
      label: string
    }

const round2 = (n: number) => Math.round(n * 100) / 100

export function buildChartModel(series: Point[], metric: string, minSpanDays = MIN_CHART_SPAN_DAYS): ChartModel {
  const byDay = new Map<string, Point>()
  for (const p of series) byDay.set(p.date, p) // last value for a day wins
  const points = [...byDay.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const cov = coverage(points.map((p) => p.date), minSpanDays)
  if (!cov.ready || points.length < 2) {
    return { kind: 'insufficient', coverage: cov, message: insufficientMessage(cov, minSpanDays) }
  }
  const first = points[0]
  const last = points[points.length - 1]
  const span = daysBetween(first.date, last.date)
  const values = points.map((p) => p.value)
  const tickValues = niceTicks(Math.min(...values), Math.max(...values))
  const lo = tickValues[0]
  const hi = tickValues[tickValues.length - 1]
  const yOf = (v: number) => round2(100 - ((v - lo) / (hi - lo)) * 100)
  const xs = points.map((p) => round2((daysBetween(first.date, p.date) / span) * 100))
  const ys = values.map(yOf)
  const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x} ${ys[i]}`).join(' ')
  const area = `${line} L${xs[xs.length - 1]} 100 L${xs[0]} 100 Z`
  const delta = last.value - first.value
  const fmt = (n: number) => n.toLocaleString('en-US')
  const label =
    `${metric}: ${fmt(first.value)} on ${formatDay(first.date, true)}, ${fmt(last.value)} on ${formatDay(last.date, true)} ` +
    `(${delta > 0 ? '+' : delta < 0 ? '−' : ''}${fmt(Math.abs(delta))} over ${span} days).`
  return {
    kind: 'ready', points, xs, ys, line, area,
    ticks: tickValues.map((value) => ({ value, y: yOf(value) })),
    first, last, delta, label,
  }
}
