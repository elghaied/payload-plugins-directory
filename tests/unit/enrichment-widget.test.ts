import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerProps } from 'payload'
import { EnrichmentWidget, pluginListUrl, truncate } from '@/components/admin/EnrichmentWidget'
import { FAILED_WHERE, LOW_CONFIDENCE, LOW_CONFIDENCE_WHERE, UNCATEGORIZED_WHERE } from '@/enrich/presets'

const failing = () => ({
  find: () => Promise.reject(new Error('relation "plugins" does not exist')),
  findGlobal: () => Promise.reject(new Error('boom')),
  count: () => Promise.reject(new Error('boom')),
  db: { drizzle: { select: () => ({ from: () => ({ where: () => Promise.reject(new Error('boom')) }) }) } },
  logger: { error: vi.fn() },
})

describe('EnrichmentWidget', () => {
  it('builds list links from the shared preset predicates', () => {
    expect(pluginListUrl(UNCATEGORIZED_WHERE)).toBe('/admin/collections/plugins?where[category][exists]=false')
    expect(pluginListUrl(FAILED_WHERE)).toBe('/admin/collections/plugins?where[ai.failedAt][exists]=true')
    expect(pluginListUrl(LOW_CONFIDENCE_WHERE)).toBe(`/admin/collections/plugins?where[ai.confidence][less_than]=${LOW_CONFIDENCE}`)
  })

  it('truncates long text', () => {
    expect(truncate('x'.repeat(500)).length).toBe(140)
    expect(truncate('short')).toBe('short')
  })

  it('renders nothing for a non-admin and an error state when the loader throws', async () => {
    const payload = failing()
    const props = (user: unknown) => ({ req: { user, payload } }) as unknown as WidgetServerProps
    expect(await EnrichmentWidget(props(null))).toBeNull()
    const html = renderToStaticMarkup((await EnrichmentWidget(props({ collection: 'users' })))!)
    expect(html).toContain('AI enrichment')
    expect(html).toContain('could not be loaded')
    expect(html).not.toContain('relation')
    expect(payload.logger.error).toHaveBeenCalledOnce()
  })
})
