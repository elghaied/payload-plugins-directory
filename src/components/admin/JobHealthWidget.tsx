import Link from 'next/link'
import type { WidgetServerProps } from 'payload'
import { Pill } from '@payloadcms/ui'
import { isAdminUser } from '@/access'
import { getJobsOverview, type JobsOverview, type TaskRow } from '@/sync/jobsOverview'
import { MANUAL_JOBS } from '@/sync/manualJobs'
import { clock, duration, plural, relativeTime } from './format'
import { LiveRefresh } from './LiveRefresh'
import { RunJobButton } from './RunJobButton'
import './dashboard.css'

/** Readable names; the task slug is shown under each one. */
export const TASK_LABELS: Record<string, string> = {
  discover: 'Discover plugins',
  'sync-repository': 'Sync plugin repo',
  'discover-templates': 'Discover templates',
  'sync-template': 'Sync template',
  'npm-stats': 'npm stats',
  snapshot: 'Daily snapshot',
  'render-readmes': 'Render READMEs',
  'enrich-all': 'AI enrichment sweep',
  enrich: 'Enrich plugin',
  'enrich-batch': 'Apply AI batch',
  'enrich-template': 'Enrich template',
  revalidate: 'Refresh page cache',
  'search-resync': 'Refresh search rows',
}
const label = (slug: string) => TASK_LABELS[slug] ?? slug
const manual = (slug: string) => MANUAL_JOBS.find((j) => j.task === slug)

function RunButton({ slug }: { slug: string }) {
  const job = manual(slug)
  if (!job) return null
  return <RunJobButton task={job.task} label={job.label} confirm={'confirm' in job ? job.confirm : undefined} />
}

function Now({ o, now }: { o: JobsOverview; now: Date }) {
  if (o.runs.length === 0 && o.running.length === 0) {
    return <div className="pd-empty">Nothing is running. The worker picks up due jobs every minute.</div>
  }
  return (
    <div className="pd-now">
      {o.runs.map((r) => (
        <div className="pd-run" key={r.key}>
          <div className="pd-run__top">
            <span className="pd-run__name">
              <span className="pd-dot pd-dot--running" aria-hidden />
              {r.label}
            </span>
            <span className="pd-small pd-muted">started {relativeTime(r.startedAt, now)}</span>
          </div>
          <div className="pd-bar" role="progressbar" aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.done} aria-label={`${r.label} progress`}>
            <span style={{ width: `${Math.max(2, r.pct)}%` }} />
          </div>
          <div className="pd-run__meta">
            <span>
              <span className="pd-run__count">
                {r.done.toLocaleString('en')} / {r.total.toLocaleString('en')}
              </span>{' '}
              done · {r.pct}%
            </span>
            <span>
              {r.running} running · {r.waiting.toLocaleString('en')} waiting
            </span>
          </div>
        </div>
      ))}
      {o.running.map((j) => (
        <div className="pd-run" key={j.id}>
          <div className="pd-run__top">
            <span className="pd-run__name">
              <span className="pd-dot pd-dot--running" aria-hidden />
              {label(j.task)}
              {j.subject && <span className="pd-mono pd-muted">{j.subject}</span>}
            </span>
            <span className="pd-small pd-muted">{j.startedAt ? `running for ${duration(now.getTime() - Date.parse(j.startedAt))}` : 'running'}</span>
          </div>
          <div className={`pd-bar ${j.estimate ? 'pd-bar--estimate' : 'pd-bar--indeterminate'}`} role="progressbar" aria-label={`${label(j.task)} progress`}>
            <span style={{ width: `${j.estimate?.pct ?? 35}%` }} />
          </div>
          <div className="pd-run__meta">
            <span>{j.estimate ? `about ${j.estimate.pct}% (estimated from the last run)` : 'first run: no estimate yet'}</span>
            {j.estimate && <span>usually takes {duration(j.estimate.typicalMs)}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function UpNext({ o, now }: { o: JobsOverview; now: Date }) {
  if (o.upcoming.length === 0) return <div className="pd-empty">Nothing scheduled yet.</div>
  return (
    <ul className="pd-list">
      {o.upcoming.slice(0, 7).map((u) => (
        <li key={u.task}>
          <span className="pd-time">{u.kind === 'due' ? 'due' : clock(u.at, now).replace(' UTC', '')}</span>
          <span className="pd-when">
            <strong>{label(u.task)}</strong>
            <span className="pd-small pd-muted">
              {u.kind === 'due' ? 'waiting for the worker' : relativeTime(u.at, now)}
              {u.kind === 'retry' && ' · retry after a rate limit'}
            </span>
          </span>
          {u.manual ? <RunButton slug={u.task} /> : <span />}
        </li>
      ))}
    </ul>
  )
}

function Queues({ o }: { o: JobsOverview }) {
  const hint: Record<string, string> = { default: 'schedules, cache', sync: 'GitHub syncs, 4 at a time', enrich: 'Claude, 2 at a time' }
  return (
    <div className="pd-queues">
      {o.queues.map((q) => (
        <div className="pd-queue" key={q.queue}>
          <span>
            <span className="pd-queue__name">{q.queue}</span>
            <span className="pd-small pd-muted" style={{ display: 'block' }}>
              {hint[q.queue]}
            </span>
          </span>
          <span className="pd-queue__nums">
            <span>
              <span className={`pd-dot ${q.running ? 'pd-dot--running' : ''}`} aria-hidden /> {q.running} running
            </span>
            <span>{q.waiting.toLocaleString('en')} waiting</span>
          </span>
        </div>
      ))}
    </div>
  )
}

const STATUS_TEXT: Record<TaskRow['status'], string> = { ok: 'OK', failing: 'Failing', overdue: 'Overdue', never: 'Never ran' }

function Tasks({ o, now }: { o: JobsOverview; now: Date }) {
  return (
    <div className="pd-tasks">
      <div className="pd-task pd-task--head">
        <span>Task</span>
        <span>Last run</span>
        <span>Result</span>
        <span style={{ textAlign: 'right' }}>Next</span>
      </div>
      {o.tasks.map((t) => (
        <div className="pd-task" key={t.slug}>
          <span className="pd-task__name">
            <span className={`pd-dot ${t.running ? 'pd-dot--running' : `pd-dot--${t.status}`}`} title={STATUS_TEXT[t.status]} />
            <span>
              <strong>{label(t.slug)}</strong>
              <span className="pd-task__sub">
                <span className="pd-mono">{t.slug}</span> · {t.schedule ?? 'on demand'}
              </span>
            </span>
          </span>
          <span>
            {relativeTime(t.lastRunAt, now)}
            {t.durationMs !== null && <span className="pd-muted"> · {duration(t.durationMs)}</span>}
            {t.status === 'overdue' && <span style={{ color: 'var(--color-text-warning)' }}> · overdue</span>}
          </span>
          <span className={`pd-task__result ${t.lastError ? 'pd-task__result--error' : ''}`} title={t.lastError ?? t.summary ?? undefined}>
            {t.lastError ?? t.summary ?? <span className="pd-muted">–</span>}
            {(t.running > 0 || t.waiting > 0) && (
              <span className="pd-muted">
                {' '}
                ({t.running ? `${t.running} running` : ''}
                {t.running && t.waiting ? ', ' : ''}
                {t.waiting ? `${t.waiting.toLocaleString('en')} waiting` : ''})
              </span>
            )}
          </span>
          <span className="pd-task__action">
            {t.nextAt && <span className="pd-small pd-muted">{Date.parse(t.nextAt) <= now.getTime() ? 'due' : relativeTime(t.nextAt, now)}</span>}
            {t.manual && <RunButton slug={t.slug} />}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Background jobs: what runs now (with progress), what waits, what is scheduled next, and how each task last went. */
export async function JobHealthWidget({ req }: WidgetServerProps) {
  // Defence in depth: the admin panel is admin-only already, and the loader is called nowhere else.
  if (!isAdminUser(req.user)) return null
  const now = new Date()
  let o: JobsOverview
  try {
    o = await getJobsOverview(req.payload, now)
  } catch (err) {
    // A loader failure (e.g. job_status missing before migrations ran) must not break the whole dashboard.
    req.payload.logger.error({ err, msg: 'Jobs widget: could not load job health' })
    return (
      <section className="pd-panel">
        <div>
          <span className="pd-eyebrow">Background worker</span>
          <h2 className="pd-title">Jobs</h2>
        </div>
        <p role="alert" className="pd-alert pd-alert--danger" style={{ margin: 0 }}>
          Job health could not be loaded. See the server log for details.
        </p>
        <div className="pd-pills">
          {MANUAL_JOBS.map((j) => (
            <span key={j.task} className="pd-pills">
              <span className="pd-small">{j.label}</span>
              <RunButton slug={j.task} />
            </span>
          ))}
        </div>
      </section>
    )
  }
  const busy = o.counts.running > 0 || o.counts.waiting > 0
  const quota = o.githubQuota
  const quotaPct = quota && quota.limit ? Math.round((quota.remaining / quota.limit) * 100) : null
  const failing = o.tasks.filter((t) => t.status === 'failing').length
  return (
    <section className="pd-panel">
      <div className="pd-head">
        <div>
          <span className="pd-eyebrow">Background worker</span>
          <h2 className="pd-title">Jobs</h2>
        </div>
        <div className="pd-pills">
          <Pill pillStyle={o.counts.running ? 'success' : 'light-gray'} rounded>
            {o.counts.running} running
          </Pill>
          <Pill pillStyle={o.counts.waiting ? 'warning' : 'light-gray'} rounded>
            {o.counts.waiting.toLocaleString('en')} waiting
          </Pill>
          <Pill pillStyle="light-gray" rounded>
            {o.counts.scheduled} scheduled
          </Pill>
          {failing > 0 && (
            <Pill pillStyle="error" rounded>
              {plural(failing, 'task')} failing
            </Pill>
          )}
          <LiveRefresh intervalMs={busy ? 5_000 : 30_000} busy={busy} />
        </div>
      </div>

      {o.stalledSinceMs !== null && (
        <p role="alert" className="pd-alert pd-alert--danger" style={{ margin: 0 }}>
          Jobs have been due for {duration(o.stalledSinceMs)} and none is running. Check that the worker container is up.
        </p>
      )}
      {o.discoverWarning && (
        <p role="alert" className="pd-alert" style={{ margin: 0 }}>
          {o.discoverWarning}
        </p>
      )}

      <div>
        <h3 className="pd-section-title">Now</h3>
        <Now o={o} now={now} />
      </div>

      <div className="pd-split">
        <div>
          <h3 className="pd-section-title">Up next</h3>
          <UpNext o={o} now={now} />
        </div>
        <div>
          <h3 className="pd-section-title">Queues</h3>
          <Queues o={o} />
        </div>
      </div>

      <div>
        <h3 className="pd-section-title">Tasks</h3>
        <Tasks o={o} now={now} />
      </div>

      {o.recentFailures.length > 0 && (
        <div>
          <h3 className="pd-section-title">Recent failures</h3>
          <ul className="pd-list">
            {o.recentFailures.map((f) => (
              <li key={f.id}>
                <span className="pd-time pd-small">{relativeTime(f.at, now)}</span>
                <span className="pd-when">
                  <strong>
                    {label(f.task)}
                    {f.times > 1 && <span className="pd-muted"> ×{f.times}</span>}
                  </strong>
                  <span className="pd-small" style={{ color: 'var(--color-text-danger)', overflowWrap: 'anywhere' }}>
                    {f.error ?? 'failed'}
                  </span>
                </span>
                <Link className="pd-link pd-small" href={`/admin/collections/payload-jobs/${f.id}`}>
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pd-foot">
        {quota ? (
          <div className="pd-quota">
            <span className="pd-small">
              GitHub API: <strong>{quota.remaining.toLocaleString('en')}</strong> of {quota.limit.toLocaleString('en')} requests left
              {quota.resetAt ? <span className="pd-muted"> · resets {relativeTime(quota.resetAt, now)}</span> : null}
            </span>
            <div className={`pd-bar ${quotaPct !== null && quotaPct < 15 ? 'pd-bar--danger' : quotaPct !== null && quotaPct < 40 ? 'pd-bar--warning' : 'pd-bar--success'}`}>
              <span style={{ width: `${quotaPct ?? 0}%` }} />
            </div>
          </div>
        ) : (
          <span className="pd-small pd-muted">GitHub quota: not seen yet</span>
        )}
        <Link className="pd-link pd-small" href="/admin/collections/payload-jobs?where[hasError][equals]=true">
          {plural(o.counts.failed7d, 'failed job')} in 7 days
        </Link>
      </div>
    </section>
  )
}
