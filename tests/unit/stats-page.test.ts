import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ growth: null as unknown, fail: false }))
vi.mock('@/lib/directory/queries', () => ({
  getPluginSummaries: async () => [],
  getDirectoryMeta: async () => ({ lastUpdated: '2026-10-19T00:00:00.000Z' }),
}))
vi.mock('@/lib/trends/queries', () => ({
  getEcosystemGrowth: async () => {
    if (state.fail) throw new Error('db down')
    return state.growth
  },
}))
vi.mock('@/lib/trends/days', async (orig) => ({ ...(await orig<typeof import('@/lib/trends/days')>()), utcToday: () => '2026-10-19' }))

import StatsPage, * as stats from '@/app/(site)/stats/page'

const render = async () => renderToStaticMarkup((await StatsPage()) as never)
beforeEach(() => {
  state.growth = { stars: [], downloads: [], lastSnapshotDay: null }
  state.fail = false
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('stats page', () => {
  it('renders per request with its own canonical and og:url', () => {
    expect(stats.dynamic).toBe('force-dynamic')
    expect(stats.metadata.alternates?.canonical).toBe('/stats')
    expect(stats.metadata.openGraph?.url).toBe('/stats')
  })
  it('shows the not-collected-yet state when there are no snapshots', async () => {
    const html = await render()
    expect(html).toContain('Daily snapshots have not started yet.')
    expect(html).not.toContain('Data as of')
  })
  it('shows "Data as of" only when the last snapshot is more than 2 days old', async () => {
    state.growth = { stars: [], downloads: [], lastSnapshotDay: '2026-10-15' }
    expect(await render()).toContain('Data as of Oct 15, 2026')
    state.growth = { stars: [], downloads: [], lastSnapshotDay: '2026-10-17' }
    expect(await render()).not.toContain('Data as of')
  })
  it('keeps the page up on a query failure without claiming snapshots have not started', async () => {
    state.fail = true
    const html = await render()
    expect(html).toContain('Growth data is unavailable right now.')
    expect(html).not.toContain('Daily snapshots have not started yet.')
    expect(html).toContain('Payload Version Adoption')
  })
})
