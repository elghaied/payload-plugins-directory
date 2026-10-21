import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerProps } from 'payload'
import { SubmissionsWidget } from '@/components/admin/SubmissionsWidget'

vi.mock('@payloadcms/ui', () => ({ Button: ({ children }: { children: unknown }) => createElement('button', { type: 'button' }, children as never) }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

const now = new Date().toISOString()
const docs = [
  { id: 7, type: 'listing', kind: 'template', url: 'https://github.com/acme/site', path: 'apps/site', submittedBy: { id: 1, login: 'octo' }, note: 'Please list it', createdAt: now },
  { id: 8, type: 'claim', kind: 'plugin', plugin: { id: 3, name: 'SEO Kit', slug: 'seo-kit' }, submittedBy: { id: 2, login: 'mona' }, createdAt: now },
]

function props(user: unknown, find: () => Promise<unknown>) {
  const error = vi.fn()
  return { props: { req: { user, payload: { find, logger: { error } } } } as unknown as WidgetServerProps, error }
}

describe('SubmissionsWidget', () => {
  it('lists pending submissions oldest first, with Approve / Reject / Duplicate on each', async () => {
    const find = vi.fn(async () => ({ docs, totalDocs: 30 }))
    const html = renderToStaticMarkup((await SubmissionsWidget(props({ collection: 'users' }, find).props))!)
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ collection: 'submissions', sort: 'createdAt', where: { status: { equals: 'pending' } } }))
    expect(html).toContain('Submissions waiting: 30')
    expect(html).toContain('href="https://github.com/acme/site"')
    expect(html).toContain('apps/site')
    expect(html).toContain('href="/plugins/seo-kit"')
    expect(html).toContain('@octo')
    expect(html).toContain('Please list it')
    expect(html.match(/>Approve</g)).toHaveLength(2)
    expect(html.match(/>Reject</g)).toHaveLength(2)
    expect(html).toContain('Showing the oldest 2 of 30')
  })

  it('never links a non-http(s) URL', async () => {
    const bad = [{ ...docs[0], id: 9, url: 'javascript:alert(1)' }, { ...docs[0], id: 10, url: 'some-npm-package' }]
    const html = renderToStaticMarkup((await SubmissionsWidget(props({ collection: 'users' }, async () => ({ docs: bad, totalDocs: 2 })).props))!)
    expect(html).not.toContain('href="javascript:')
    expect(html).not.toContain('href="some-npm-package"')
    expect(html).toContain('javascript:alert(1)') // still shown as plain text for the reviewer
  })

  it('says when there is nothing to review', async () => {
    const html = renderToStaticMarkup((await SubmissionsWidget(props({ collection: 'users' }, async () => ({ docs: [], totalDocs: 0 })).props))!)
    expect(html).toContain('Nothing to review.')
  })

  it('shows an error state instead of breaking the dashboard, and renders nothing for non-admins', async () => {
    const { props: p, error } = props({ collection: 'users' }, async () => Promise.reject(new Error('boom')))
    expect(renderToStaticMarkup((await SubmissionsWidget(p))!)).toContain('Submissions could not be loaded')
    expect(error).toHaveBeenCalledOnce()
    expect(await SubmissionsWidget(props(null, async () => ({ docs, totalDocs: 2 })).props)).toBeNull()
  })
})
