import type { WidgetServerProps } from 'payload'
import { isAdminUser } from '@/access'
import type { Maintainer, Plugin, Submission, Template } from '@/payload-types'
import { SubmissionActions } from './SubmissionActions'

/** Rows shown at once; the rest are one click away in the Submissions list. */
export const SUBMISSIONS_WIDGET_LIMIT = 25

const muted = { color: 'var(--theme-elevation-600)' }
const linkStyle = { textDecoration: 'underline', textUnderlineOffset: '2px' }
const pill = { fontSize: '0.7rem', padding: '0.1rem 0.4rem', borderRadius: '999px', border: '1px solid var(--theme-elevation-150)' }

function age(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000))
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h ago`
  return `${Math.round(minutes / 1440)} days ago`
}

/** What the submission is about: a listing's URL, or the plugin / template a claim is for. */
function target(s: Pick<Submission, 'type' | 'kind' | 'url' | 'plugin' | 'template'>): { label: string; href: string | null } {
  if (s.type === 'listing') return { label: s.url ?? '(no URL)', href: s.url ?? null }
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
      select: { type: true, kind: true, url: true, path: true, plugin: true, template: true, submittedBy: true, note: true, createdAt: true },
    })
  } catch (err) {
    req.payload.logger.error({ err, msg: 'Submissions widget: could not load submissions' })
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Submissions</h3>
        <p role="alert" style={{ margin: '0.75rem 0 0', color: 'var(--theme-error-500)' }}>
          Submissions could not be loaded. See the server log for details.
        </p>
      </div>
    )
  }
  const now = new Date()
  const listHref = '/admin/collections/submissions?where[status][equals]=pending'
  return (
    <div className="card" style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1rem', flexWrap: 'wrap' }}>
        <h3 style={{ margin: 0 }}>Submissions waiting: {res.totalDocs}</h3>
        <a href={listHref} style={{ fontSize: '0.85rem', ...linkStyle }}>
          Open the full list
        </a>
      </div>
      {res.docs.length === 0 ? (
        <p style={{ margin: 0, ...muted }}>Nothing to review.</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: '0.5rem' }}>
          {res.docs.map((s) => {
            const t = target(s)
            const by = s.submittedBy as Maintainer | number | null
            const login = by && typeof by === 'object' ? by.login : null
            return (
              <li
                key={s.id}
                style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', padding: '0.625rem 0', borderTop: '1px solid var(--theme-elevation-100)' }}
              >
                <div style={{ display: 'grid', gap: '0.25rem', minWidth: 0, flex: '1 1 20rem' }}>
                  <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                    <span style={pill}>{s.type === 'claim' ? 'Claim' : 'Listing'}</span>
                    <span style={pill}>{s.kind === 'template' ? 'Template' : 'Plugin'}</span>
                    {t.href ? (
                      <a href={t.href} target="_blank" rel="noopener noreferrer" style={{ overflowWrap: 'anywhere', ...linkStyle }}>
                        {t.label}
                      </a>
                    ) : (
                      <span>{t.label}</span>
                    )}
                    {s.path && <code style={{ fontSize: '0.75rem' }}>{s.path}</code>}
                  </div>
                  <div style={{ fontSize: '0.75rem', ...muted }}>
                    {login ? (
                      <>
                        by{' '}
                        <a href={`https://github.com/${encodeURIComponent(login)}`} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                          @{login}
                        </a>
                      </>
                    ) : (
                      'by an unknown user'
                    )}{' '}
                    · {age(s.createdAt, now)} · <a href={`/admin/collections/submissions/${s.id}`} style={linkStyle}>Open</a>
                  </div>
                  {s.note && <p style={{ margin: 0, fontSize: '0.8rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{s.note}</p>}
                </div>
                <SubmissionActions id={s.id} label={t.label} />
              </li>
            )
          })}
        </ul>
      )}
      {res.totalDocs > res.docs.length && (
        <p style={{ margin: 0, fontSize: '0.8rem', ...muted }}>
          Showing the oldest {res.docs.length} of {res.totalDocs}. <a href={listHref} style={linkStyle}>See all</a>
        </p>
      )}
    </div>
  )
}
