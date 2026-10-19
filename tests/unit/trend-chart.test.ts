import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TrendChart } from '@/components/trends/TrendChart'
import { addDays } from '@/lib/trends/days'

const week = Array.from({ length: 8 }, (_, i) => ({ date: addDays('2026-10-12', i), value: 100 + i * 10 }))

describe('TrendChart', () => {
  it('renders the insufficient-data state with no plot and no fake zero', () => {
    const html = renderToStaticMarkup(createElement(TrendChart, { title: 'Stars', metric: 'Stars', tone: 'stars', series: [] }))
    expect(html).toContain('Trends appear after 7 days of data.')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('+0')
  })
  it('renders an accessible chart with a data table once a week of data exists', () => {
    const html = renderToStaticMarkup(
      createElement(TrendChart, { title: 'Weekly downloads', metric: 'Weekly downloads', tone: 'downloads', series: week }),
    )
    expect(html).toContain('<svg')
    expect(html).toContain('role="img"')
    expect(html).toContain('aria-label="Weekly downloads: 100 on Oct 12, 2026, 170 on Oct 19, 2026 (+70 over 7 days)."')
    expect(html).toContain('Show data')
    expect(html).toContain('<table')
    expect(html).toContain('text-violet-600')
  })
})
