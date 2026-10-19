import type { WidgetServerProps } from 'payload'
import { isAdminUser } from '@/access'
import { getJobHealth } from '@/sync/jobStatus'

const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '–')
const danger = { color: 'var(--theme-error-500)' }

/** Spec §9 job health: last success/failure per task, discover guard warning, GitHub quota, failed and pending jobs. */
export async function JobHealthWidget({ req }: WidgetServerProps) {
  // Defence in depth: the admin panel is admin-only already, and the loader is called nowhere else.
  if (!isAdminUser(req.user)) return null
  let health
  try {
    health = await getJobHealth(req.payload, new Date())
  } catch (err) {
    // A loader failure (e.g. job_status missing before migrations ran) must not break the whole dashboard.
    req.payload.logger.error({ err, msg: 'Job-health widget: could not load job health' })
    return (
      <div className="card">
        <h3 style={{ margin: 0 }}>Sync jobs</h3>
        <p role="alert" style={{ margin: '0.75rem 0 0', ...danger }}>
          Job health could not be loaded. See the server log for details.
        </p>
      </div>
    )
  }
  const quota = health.githubQuota
  return (
    <div className="card" style={{ display: 'grid', gap: '0.75rem' }}>
      <h3 style={{ margin: 0 }}>Sync jobs</h3>
      {health.discoverWarning && (
        <p role="alert" style={{ margin: 0, ...danger }}>
          {health.discoverWarning}
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Task</th>
            <th style={{ textAlign: 'left' }}>Last success</th>
            <th style={{ textAlign: 'left' }}>Last failure</th>
          </tr>
        </thead>
        <tbody>
          {health.tasks.map((t) => (
            <tr key={t.slug}>
              <td>
                {t.slug}
                {t.failing && <strong style={danger}> failing</strong>}
                {t.overdue && <strong style={danger}> overdue</strong>}
              </td>
              <td>{when(t.lastSuccessAt)}</td>
              <td>
                {when(t.lastFailureAt)}
                {t.lastError && <div style={t.failing ? danger : undefined}>{t.lastError}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--theme-elevation-600)' }}>
        Pending: {health.pending.default} default, {health.pending.sync} sync · Failed in the last 7 days: {health.failedJobs7d}
        {quota && ` · GitHub quota: ${quota.remaining}/${quota.limit}${quota.resetAt ? `, resets ${when(quota.resetAt)}` : ''}`}
      </p>
    </div>
  )
}
