'use client'

import { useId, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { buildChartModel, compactNumber, nearestIndex, signed, tickLabels } from '@/lib/trends/chartModel'
import { formatDay } from '@/lib/trends/days'
import type { Point } from '@/lib/trends/growth'
import { TrendEmpty } from './TrendEmpty'

export type TrendTone = 'stars' | 'downloads'

// Validated with the dataviz palette validator: light #b45309 (4.56:1 on the #f4f4f1 background; #d97706 fell to 2.89),#7c3aed on #f4f4f1 and
// dark #d97706,#8b5cf6 on #0a0a0a → ALL CHECKS PASS. Do not swap in the -400 steps (fail dark lightness band).
const TONE_CLASS: Record<TrendTone, string> = {
  stars: 'text-amber-700 dark:text-amber-600',
  downloads: 'text-violet-600 dark:text-violet-500',
}

type Props = { title: string; metric: string; series: Point[]; tone: TrendTone; footnote?: string; outdated?: boolean }

export function TrendChart({ title, metric, series, tone, footnote, outdated }: Props) {
  const titleId = useId()
  const [active, setActive] = useState<number | null>(null)
  const model = buildChartModel(series, metric, undefined, outdated)

  const caption = (
    <figcaption id={titleId} className="text-xs font-medium text-muted-foreground">
      {title}
    </figcaption>
  )
  const note = footnote ? <p className="mt-2 text-xs text-muted-foreground">{footnote}</p> : null

  if (model.kind === 'insufficient') {
    return (
      <figure aria-labelledby={titleId}>
        {caption}
        <div className="mt-3">
          <TrendEmpty message={model.message} />
        </div>
        {note}
      </figure>
    )
  }

  const { points, xs, ys, ticks, first, last } = model
  const lastIndex = points.length - 1
  const shown = active ?? lastIndex

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    setActive(nearestIndex(xs, ((e.clientX - rect.left) / rect.width) * 100))
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = active ?? lastIndex
    const next =
      e.key === 'ArrowLeft' ? i - 1 : e.key === 'ArrowRight' ? i + 1 : e.key === 'Home' ? 0 : e.key === 'End' ? lastIndex : null
    if (next === null) return
    e.preventDefault()
    setActive(Math.min(lastIndex, Math.max(0, next)))
  }

  const axisLabels = tickLabels(ticks.map((t) => t.value))

  return (
    <figure aria-labelledby={titleId}>
      {caption}
      <p className="mt-1 flex items-baseline gap-2">
        <span className="text-lg font-semibold tabular-nums">{compactNumber(last.value)}</span>
        <span className="text-xs text-muted-foreground">
          {signed(model.delta)} since {formatDay(first.date)}
        </span>
      </p>
      <div className="mt-3 flex gap-2">
        <div aria-hidden className="relative h-32 w-10 shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
          {ticks.map((t, ti) => (
            <span key={t.value} className="absolute right-0 -translate-y-1/2" style={{ top: `${t.y}%` }}>
              {axisLabels[ti]}
            </span>
          ))}
        </div>
        <div
          role="img"
          aria-label={model.label}
          tabIndex={0}
          className="relative h-32 flex-1 touch-pan-y rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onPointerMove={onPointerMove}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={onKeyDown}
        >
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
            className={`absolute inset-0 h-full w-full overflow-visible ${TONE_CLASS[tone]}`}
          >
            {ticks.map((t) => (
              <line key={t.value} x1={0} x2={100} y1={t.y} y2={t.y} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={model.area} fill="currentColor" fillOpacity={0.1} stroke="none" />
            <path
              d={model.line}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {active !== null && (
              <line
                x1={xs[active]}
                x2={xs[active]}
                y1={0}
                y2={100}
                className="stroke-muted-foreground"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <span
            aria-hidden
            className={`pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current ring-2 ring-card ${TONE_CLASS[tone]}`}
            style={{ left: `${xs[shown]}%`, top: `${ys[shown]}%` }}
          />
          {active !== null && (
            <div
              aria-hidden
              className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
              style={{ left: `${Math.min(85, Math.max(15, xs[active]))}%` }}
            >
              <span className="font-semibold tabular-nums">{points[active].value.toLocaleString('en-US')}</span>{' '}
              <span className="text-muted-foreground">{formatDay(points[active].date, true)}</span>
            </div>
          )}
        </div>
      </div>
      <div aria-hidden className="ml-12 mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{formatDay(first.date)}</span>
        <span>{formatDay(last.date)}</span>
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Show data</summary>
        <div className="mt-2 max-h-48 overflow-y-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{title} by day (UTC)</caption>
            <thead>
              <tr>
                <th scope="col" className="font-medium">Date</th>
                <th scope="col" className="text-right font-medium">{metric}</th>
              </tr>
            </thead>
            <tbody>
              {[...points].reverse().map((p) => (
                <tr key={p.date}>
                  <td>{formatDay(p.date, true)}</td>
                  <td className="text-right">{p.value.toLocaleString('en-US')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {note}
    </figure>
  )
}
