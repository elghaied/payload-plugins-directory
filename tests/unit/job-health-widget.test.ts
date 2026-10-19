import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerProps } from 'payload'
import { JobHealthWidget } from '@/components/admin/JobHealthWidget'

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

  it('renders nothing for a non-admin', async () => {
    const { props } = propsWithFailingLoader()
    expect(await JobHealthWidget({ ...props, req: { ...props.req, user: null } } as unknown as WidgetServerProps)).toBeNull()
  })
})
