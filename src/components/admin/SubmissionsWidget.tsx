import Link from 'next/link'
import type { WidgetServerProps } from 'payload'
import { Pill } from '@payloadcms/ui'
import { isAdminUser } from '@/access'
import type { Maintainer, Plugin, Submission, Template } from '@/payload-types'
import { SubmissionActions } from './SubmissionActions'
import './dashboard.css'

/** Rows shown at once; the rest are one click away in the Submissions list. */
export const SUBMISSIONS_WIDGET_LIMIT = 25


function age(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} days ago`
}

/** Only http(s) URLs become links: `url` is submitter input (validated on save, but never trusted in an admin page). */
function safeHref(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

/** What the submission is about: a listing's URL, or the plugin / template a claim is for. */
function target(s: Pick<Submission, 'type' | 'kind' | 'url' | 'plugin' | 'template'>): { label: string; href: string | null } {
  if (s.type === 'listing') return { label: s.url ?? '(no URL)', href: safeHref(s.url) }
  const listing = (s.kind === 'template' ? s.template : s.plugin) as Plugin | Template | number | null | undefined
  if (!listing || typeof listing === 'number') return { label: `(missing ${s.kind})`, href: null }
  return { label: listing.name ?? listing.slug, href: `/${s.kind === 'template' ? 'templates' : 'plugins'}/${encodeURIComponent(listing.slug)}` }
}

/** Pending submissions with one-click Approve / Reject / Duplicate, oldest first. */
export async function SubmissionsWidget({ req }: WidgetServerProps) {
  if (!isAdminUser(req.user)) return null
  let res
  try {
    res = await req.payload.find({
      collection: 'submissions',
      overrideAccess: true,
      depth: 1,
      limit: SUBMISSIONS_WIDGET_LIMIT,
      sort: 'createdAt',
      where: { status: { equals: 'pending' } },
      select: { type: true, kind: true, url: true, path: true, plugin: true, template: true, submittedBy: true, note: true, createdAt: true, origin: true },
    })
  } catch (err) {
    req.payload.logger.error({ err, msg: 'Submissions widget: could not load submissions' })
    return (
      <section className="pd-panel">
        <div>
          <span className="pd-eyebrow">Review queue</span>
          <h2 className="pd-title">Submissions</h2>
        </div>
        <p role="alert" className="pd-alert pd-alert--danger" style={{ margin: 0 }}>
          Submissions could not be loaded. See the server log for details.
        </p>
      </section>
    )
  }
  const now = new Date()
  const listHref = '/admin/collections/submissions?where[status][equals]=pending'
  return (
    <section className="pd-panel">
      <div className="pd-head">
        <div>
          <span className="pd-eyebrow">Review queue</span>
          <h2 className="pd-title">Submissions</h2>
        </div>
        <div className="pd-pills">
          <Pill pillStyle={res.totalDocs ? 'warning' : 'success'} rounded>
            {res.totalDocs ? `${res.totalDocs} waiting` : 'All clear'}
          </Pill>
          <a className="pd-link pd-small" href={listHref}>
            Open the full list
          </a>
        </div>
      </div>
      {res.docs.length === 0 ? (
        <div className="pd-empty">Nothing to review.</div>
      ) : (
        <ul className="pd-subs">
          {res.docs.map((s) => {
            const t = target(s)
            const by = s.submittedBy as Maintainer | number | null
            const login = by && typeof by === 'object' ? by.login : null
            return (
              <li className="pd-sub" key={s.id}>
                <span className="pd-avatar" aria-hidden>
                  {s.origin === 'discovery' ? '✦' : (login ?? '?').slice(0, 2)}
                </span>
                <div className="pd-sub__body">
                  <div className="pd-pills">
                    <Pill pillStyle={s.type === 'claim' ? 'dark' : 'light'} rounded size="small">
                      {s.type === 'claim' ? 'Claim' : 'Listing'}
                    </Pill>
                    <Pill pillStyle="light-gray" rounded size="small">
                      {s.kind === 'template' ? 'Template' : 'Plugin'}
                    </Pill>
                    {s.origin === 'discovery' && (
                      <Pill pillStyle="warning" rounded size="small">
                        Suggested
                      </Pill>
                    )}
                    {s.path && <span className="pd-mono pd-muted">{s.path}</span>}
                  </div>
                  {t.href ? (
                    <a className="pd-sub__target pd-link" href={t.href} target="_blank" rel="noopener noreferrer">
                      {t.label}
                    </a>
                  ) : (
                    <span className="pd-sub__target">{t.label}</span>
                  )}
                  <span className="pd-small pd-muted">
                    {s.origin === 'discovery' ? (
                      'found by template discovery'
                    ) : login ? (
                      <>
                        by{' '}
                        <a className="pd-link" href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noopener noreferrer">
                          @{login}
                        </a>
                      </>
                    ) : (
                      'by an unknown user'
                    )}{' '}
                    · {age(s.createdAt, now)} ·{' '}
                    <Link className="pd-link" href={`/admin/collections/submissions/${s.id}`}>
                      Open
                    </Link>
                  </span>
                  {s.note && <p className="pd-sub__note">{s.note}</p>}
                </div>
                <SubmissionActions id={s.id} label={t.label} />
              </li>
            )
          })}
        </ul>
      )}
      {res.totalDocs > res.docs.length && (
        <p className="pd-small pd-muted" style={{ margin: 0 }}>
          Showing the oldest {res.docs.length} of {res.totalDocs}.{' '}
          <a className="pd-link" href={listHref}>
            See all
          </a>
        </p>
      )}
    </section>
  )
}
