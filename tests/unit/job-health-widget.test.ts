import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerProps } from 'payload'
import { JobHealthWidget } from '@/components/admin/JobHealthWidget'
import { MANUAL_JOBS } from '@/sync/manualJobs'

vi.mock('@payloadcms/ui', () => ({ Button: ({ children }: { children: unknown }) => createElement('button', { type: 'button' }, children as never) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

function propsWithFailingLoader() {
  const error = vi.fn()
  const payload = {
    logger: { error },
    db: {
      drizzle: {
        select: () => ({
          from: () => Promise.reject(new Error('relation "job_status" does not exist')),
        }),
      },
    },
  }
  return { props: { req: { user: { collection: 'users' }, payload } } as unknown as WidgetServerProps, error }
}

describe('JobHealthWidget', () => {
  it('renders an error state and logs when the loader throws, instead of breaking the dashboard', async () => {
    const { props, error } = propsWithFailingLoader()
    const element = await JobHealthWidget(props)
    const html = renderToStaticMarkup(element!)
    expect(html).toContain('Sync jobs')
    expect(html).toContain('Job health could not be loaded')
    expect(html).not.toContain('job_status') // no internal error text in the UI
    expect(error).toHaveBeenCalledOnce()
  })

  it('still offers a Run now button for every directory-wide job when the loader throws', async () => {
    const { props } = propsWithFailingLoader()
    const html = renderToStaticMarkup((await JobHealthWidget(props))!)
    expect(html).toContain('Run now')
    for (const j of MANUAL_JOBS) expect(html).toContain(`>${j.label}</button>`)
    expect(MANUAL_JOBS.map((j) => j.task)).toEqual(['discover', 'discover-templates', 'npm-stats', 'snapshot', 'render-readmes', 'enrich-all'])
  })

  it('renders nothing for a non-admin', async () => {
    const { props } = propsWithFailingLoader()
    expect(await JobHealthWidget({ ...props, req: { ...props.req, user: null } } as unknown as WidgetServerProps)).toBeNull()
  })
})
