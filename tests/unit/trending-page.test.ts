import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coverage } from '@/lib/trends/growth'
import type { TrendingData } from '@/lib/trends/types'

const state = vi.hoisted(() => ({ data: null as unknown, fail: false }))
vi.mock('next/link', async () => {
  const { createElement } = await import('react')
  return { default: ({ href, children }: { href: string; children: unknown }) => createElement('a', { href }, children as never) }
})
vi.mock('@/lib/trends/queries', () => ({ getTrendingData: async () => {
    if (state.fail) throw new Error('db down')
    return state.data
  },
}))

import TrendingPage, * as trending from '@/app/(site)/trending/page'

const none: Coverage = { ready: false, firstDay: null, lastDay: null, daysCollected: 0 } as Coverage
const base = (extra: Partial<TrendingData> = {}): TrendingData => ({
  today: '2026-10-19', lastSnapshotDay: null, starsCoverage: none, downloadsCoverage: none,
  starsComparable: false, downloadsComparable: false, stars: [], downloads: [], newThisMonth: [], recentlyUpdated: [], ...extra,
})
const render = async (data: TrendingData) => {
  state.data = data
  return renderToStaticMarkup((await TrendingPage()) as never)
}
beforeEach(() => {
  state.data = null
  state.fail = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('trending page', () => {
  it('renders per request with its own canonical and og:url', () => {
    expect(trending.dynamic).toBe('force-dynamic')
    expect(trending.metadata.alternates?.canonical).toBe('/trending')
    expect(trending.metadata.openGraph?.url).toBe('/trending')
  })
  it('shows the not-collected-yet state and no "Data as of" when there are no snapshots', async () => {
    const html = await render(base())
    expect(html).toContain('Daily snapshots have not started yet.')
    expect(html).not.toContain('Data as of')
  })
  it('shows "Data as of" only when the last snapshot is more than 2 days old', async () => {
    expect(await render(base({ lastSnapshotDay: '2026-10-15' }))).toContain('Data as of Oct 15, 2026')
    expect(await render(base({ lastSnapshotDay: '2026-10-17' }))).not.toContain('Data as of')
  })
  it('does not claim nothing grew when the 7-day baseline is missing', async () => {
    const ready = { ready: true, firstDay: '2026-09-01', lastDay: '2026-10-19', daysCollected: 40, spanDays: 48 } as Coverage
    const html = await render(base({ starsCoverage: ready, downloadsCoverage: ready, lastSnapshotDay: '2026-10-19' }))
    expect(html).not.toContain('No repository gained stars this week.')
    expect(html).not.toContain('No plugin gained weekly downloads this week.')
    expect(html).toContain('Not enough data to compare yet')
    const ok = await render(base({ starsCoverage: ready, downloadsCoverage: ready, starsComparable: true, downloadsComparable: true }))
    expect(ok).toContain('No repository gained stars this week.')
  })
  it('says so in words for an empty list', async () => {
    expect(await render(base())).toContain('No new plugins in the last 30 days.')
  })
  it('includes the year for an added date from another year', async () => {
    const n = { slug: 'a', name: 'A', owner: 'o', ownerAvatar: '', addedOn: '2025-12-30', reason: 'newly-listed' as const }
    const html = await render(base({ today: '2026-01-05', newThisMonth: [n] }))
    // The visible (aria-hidden) value carries the year, not only the sr-only label.
    expect(html).toMatch(/aria-hidden="true"[^>]*>Dec 30, 2025<\/span>/)
    const same = await render(base({ today: '2026-01-05', newThisMonth: [{ ...n, addedOn: '2026-01-03' }] }))
    expect(same).toMatch(/aria-hidden="true"[^>]*>Jan 3<\/span>/)
  })
  it('keeps the page up with a neutral message when the query fails', async () => {
    state.fail = true
    const html = renderToStaticMarkup((await TrendingPage()) as never)
    expect(html).toContain('Trending data is unavailable right now.')
    expect(html).not.toContain('Daily snapshots have not started yet.')
  })
})
