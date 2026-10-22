import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerProps } from 'payload'
import { buildJobsOverview } from '@/sync/jobsOverview'
import { MANUAL_JOBS } from '@/sync/manualJobs'

vi.mock('@payloadcms/ui', () => ({
  Pill: ({ children }: { children: unknown }) => createElement('span', { className: 'pill' }, children as never),
  toast: { success: () => {}, info: () => {}, error: () => {} },
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
const overview = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('@/sync/jobsOverview', async (orig) => {
  const real = await orig<typeof import('@/sync/jobsOverview')>()
  return { ...real, getJobsOverview: vi.fn(async () => { if (overview.value instanceof Error) throw overview.value; return overview.value }) }
})
const { JobHealthWidget } = await import('@/components/admin/JobHealthWidget')

const NOW = Date.now()
const iso = (min: number) => new Date(NOW + min * 60_000).toISOString()

function props(user: unknown = { collection: 'users' }) {
  const error = vi.fn()
  return { props: { req: { user, payload: { logger: { error } } } } as unknown as WidgetServerProps, error }
}

describe('JobHealthWidget', () => {
  it('shows runs with progress, upcoming jobs, queues and every task, refreshing live while busy', async () => {
    overview.value = buildJobsOverview({
      now: new Date(NOW),
      rows: [{ key: 'discover', lastSuccessAt: new Date(NOW - 600_000), lastFailureAt: null, lastError: null, details: { status: 'ok', queued: 10, durationMs: 4200 }, updatedAt: null }],
      active: [
        ...Array.from({ length: 4 }, (_, i) => ({ id: i + 1, taskSlug: 'sync-repository', queue: 'sync', createdAt: iso(-5), waitUntil: null, processingUntil: i === 0 ? iso(5) : null, input: { fullName: `a/b${i}` }, totalTried: 0 })),
        { id: 9, taskSlug: 'discover-templates', queue: 'default', createdAt: iso(-60), waitUntil: iso(14), processingUntil: null, input: {}, totalTried: 0 },
      ],
      failed: [],
      failed7d: 0,
      schedules: { 'discover-templates': 'every 6 h at :15' },
    })
    const html = renderToStaticMarkup((await JobHealthWidget(props().props))!)
    expect(html).toContain('Plugin sync')
    expect(html).toContain('aria-valuenow="6"') // 10 queued, 4 left
    expect(html).toContain('1 running · 3 waiting')
    expect(html).toContain('Discover templates')
    expect(html).toContain('in 14 min')
    expect(html).toContain('queued 10')
    expect(html).toContain('Live')
    for (const j of MANUAL_JOBS) expect(html).toContain(`aria-label="Run ${j.label} now"`)
  })

  it('renders an error state (with the Run now buttons) when the loader throws, instead of breaking the dashboard', async () => {
    overview.value = new Error('relation "job_status" does not exist')
    const { props: p, error } = props()
    const html = renderToStaticMarkup((await JobHealthWidget(p))!)
    expect(html).toContain('Job health could not be loaded')
    expect(html).not.toContain('job_status')
    for (const j of MANUAL_JOBS) expect(html).toContain(`aria-label="Run ${j.label} now"`)
    expect(error).toHaveBeenCalledOnce()
  })

  it('renders nothing for a non-admin', async () => {
    expect(await JobHealthWidget(props(null).props)).toBeNull()
  })
})
