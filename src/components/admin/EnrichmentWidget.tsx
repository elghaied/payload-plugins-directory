import type { Where, WidgetServerProps } from 'payload'
import { isAdminUser } from '@/access'
import { getEnrichmentHealth } from '@/enrich/health'
import { FAILED_WHERE, LOW_CONFIDENCE_WHERE, UNCATEGORIZED_WHERE } from '@/enrich/presets'

const when = (iso: string | null) => (iso ? `${iso.slice(0, 16).replace('T', ' ')} UTC` : '–')
const danger = { color: 'var(--theme-error-500)' }
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
      <div className="card">
        <h3 style={{ margin: 0 }}>AI enrichment</h3>
        <p role="alert" style={{ margin: '0.75rem 0 0', ...danger }}>
          Enrichment health could not be loaded. See the server log for details.
        </p>
      </div>
    )
  }
  return (
    <div className="card" style={{ display: 'grid', gap: '0.75rem' }}>
      <h3 style={{ margin: 0 }}>AI enrichment</h3>
      {!h.enabled && (
        <p role="alert" style={{ margin: 0, ...danger }}>
          Enrichment is switched off (Directory settings → AI → enabled).
        </p>
      )}
      <p style={{ margin: 0, fontSize: '0.85rem' }}>
        {h.enriched}/{h.total} enriched with {h.model} · <a href={LINKS.uncategorized}>{h.uncategorized} uncategorized</a> ·{' '}
        <a href={LINKS.lowConfidence}>{h.lowConfidence} low confidence</a> ·{' '}
        <a href={LINKS.failed} style={h.failed ? danger : undefined}>
          {h.failed} failed
        </a>
      </p>
      {h.recentFailures.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '0.85rem' }}>
          {h.recentFailures.map((f) => (
            <li key={f.slug}>
              {truncate(f.name, 60)} — {truncate(f.reason)} ({when(f.failedAt)})
            </li>
          ))}
        </ul>
      )}
      <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--theme-elevation-600)' }}>
        Last sweep: {h.lastRun.status ?? 'never'} ({when(h.lastRun.at)})
        {h.lastError.at && ` · Last job error ${when(h.lastError.at)}: ${truncate(h.lastError.message ?? '')}`}
      </p>
    </div>
  )
}
