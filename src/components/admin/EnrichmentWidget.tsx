import type { Where, WidgetServerProps } from 'payload'
import { Pill } from '@payloadcms/ui'
import { isAdminUser } from '@/access'
import { getEnrichmentHealth } from '@/enrich/health'
import { FAILED_WHERE, LOW_CONFIDENCE_WHERE, UNCATEGORIZED_WHERE } from '@/enrich/presets'
import './dashboard.css'

const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '–')
const danger = { color: 'var(--color-text-danger)' }
const MAX_TEXT = 140

/** Failure reasons and names come from model output / GitHub: cap their length (they render as React text only). */
export const truncate = (text: string, max = MAX_TEXT): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text)

/** Admin list URL for a flat `{ field: { operator: value } }` predicate, so links reuse the preset predicates. */
export function pluginListUrl(where: Where): string {
  const parts: string[] = []
  for (const [field, condition] of Object.entries(where)) {
    for (const [operator, value] of Object.entries(condition as Record<string, unknown>)) {
      parts.push(`where[${field}][${operator}]=${encodeURIComponent(String(value))}`)
    }
  }
  return `/admin/collections/plugins?${parts.join('&')}`
}

const LINKS = {
  uncategorized: pluginListUrl(UNCATEGORIZED_WHERE),
  lowConfidence: pluginListUrl(LOW_CONFIDENCE_WHERE),
  failed: pluginListUrl(FAILED_WHERE),
}

/** AI enrichment status (spec §5, §9): kill switch, coverage, low confidence, failures, last sweep. */
export async function EnrichmentWidget({ req }: WidgetServerProps) {
  // Defence in depth: the admin panel is admin-only already, and the loader is called nowhere else.
  if (!isAdminUser(req.user)) return null
  let h
  try {
    h = await getEnrichmentHealth(req.payload)
  } catch (err) {
    req.payload.logger.error({ err, msg: 'Enrichment widget: could not load enrichment health' })
    return (
      <section className="pd-panel">
        <div>
          <span className="pd-eyebrow">AI enrichment</span>
          <h2 className="pd-title">Claude summaries</h2>
        </div>
        <p role="alert" className="pd-alert pd-alert--danger" style={{ margin: 0 }}>
          Enrichment health could not be loaded. See the server log for details.
        </p>
      </section>
    )
  }
  const coverage = h.total ? Math.round((h.enriched / h.total) * 100) : 0
  const issues = [
    { label: 'Uncategorized', count: h.uncategorized, href: LINKS.uncategorized },
    { label: 'Low confidence', count: h.lowConfidence, href: LINKS.lowConfidence },
    { label: 'Failed', count: h.failed, href: LINKS.failed },
  ]
  return (
    <section className="pd-panel">
      <div className="pd-head">
        <div>
          <span className="pd-eyebrow">AI enrichment</span>
          <h2 className="pd-title">Claude summaries</h2>
        </div>
        <Pill pillStyle={!h.enabled ? 'error' : h.failed ? 'warning' : 'success'} rounded>
          {!h.enabled ? 'Switched off' : h.failed ? `${h.failed} failed` : 'Healthy'}
        </Pill>
      </div>
      {!h.enabled && (
        <p role="alert" className="pd-alert pd-alert--danger" style={{ margin: 0 }}>
          Enrichment is switched off (Directory settings → AI → enabled).
        </p>
      )}
      <div>
        <div className="pd-score">
          <strong>{coverage}%</strong>
          <span className="pd-small pd-muted">
            {h.enriched.toLocaleString('en')} of {h.total.toLocaleString('en')} plugins
          </span>
        </div>
        <div className="pd-bar pd-bar--success" style={{ marginTop: 'var(--spacer-2)' }} aria-label={`AI coverage ${coverage}%`}>
          <span style={{ width: `${coverage}%` }} />
        </div>
      </div>
      <div className="pd-issues">
        {issues.map((i) => (
          <a key={i.label} href={i.href}>
            <span>{i.label}</span>
            <strong style={i.label === 'Failed' && i.count ? danger : undefined}>{i.count}</strong>
          </a>
        ))}
      </div>
      {h.recentFailures.length > 0 && (
        <ul className="pd-small" style={{ margin: 0, paddingLeft: '1.1rem' }}>
          {h.recentFailures.map((f) => (
            <li key={f.slug}>
              {truncate(f.name, 60)} — {truncate(f.reason)} ({when(f.failedAt)})
            </li>
          ))}
        </ul>
      )}
      <p className="pd-small pd-muted" style={{ margin: 'auto 0 0' }}>
        {h.model} · last sweep {h.lastRun.status ?? 'never'} ({when(h.lastRun.at)})
        {h.lastError.at && ` · last job error ${when(h.lastError.at)}: ${truncate(h.lastError.message ?? '')}`}
      </p>
    </section>
  )
}
