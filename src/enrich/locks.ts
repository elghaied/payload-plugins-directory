import type { CollectionBeforeChangeHook } from 'payload'
import { isAdminUser } from '@/access'
import type { Plugin } from '@/payload-types'
import { relId, sameInstant } from '@/sync/util'

type LockKey = 'category' | 'tags' | 'tagline' | 'summary' | 'features' | 'useCases'
type Doc = Partial<Plugin>

const tagIds = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [])
    .map((t) => relId(t as number | { id: number }))
    .filter((id): id is number => id !== null)
    .sort((a, b) => a - b)

/** An empty form field ('') is the same as no value: it must not count as an edit. */
const text = (v: unknown): unknown => (v === '' || v === undefined ? null : v)

/** How to read each AI-managed value, and whether this save contains it at all. */
const FIELDS: Record<LockKey, { value: (d: Doc) => unknown; present: (d: Doc) => boolean }> = {
  category: { value: (d) => relId(text(d.category) as never), present: (d) => 'category' in d },
  tags: { value: (d) => tagIds(d._h_tags), present: (d) => '_h_tags' in d },
  tagline: { value: (d) => text(d.ai?.tagline), present: (d) => Boolean(d.ai && 'tagline' in d.ai) },
  summary: { value: (d) => text(d.ai?.summary), present: (d) => Boolean(d.ai && 'summary' in d.ai) },
  features: { value: (d) => d.ai?.features ?? [], present: (d) => Boolean(d.ai && 'features' in d.ai) },
  useCases: { value: (d) => d.ai?.useCases ?? [], present: (d) => Boolean(d.ai && 'useCases' in d.ai) },
}

/** What enrichment writes (spec §5.3): a form that predates the last enrichment must not write these back. */
const AI_KEYS = ['tagline', 'summary', 'features', 'useCases', 'enrichedHash', 'promptHash', 'enrichedAt', 'confidence', 'model'] as const

/**
 * The form was loaded before the last enrichment landed: it carries enrichment metadata (read-only in the admin, so
 * only ever echoed back) that differs from the stored one.
 */
function predatesEnrichment(data: Doc, originalDoc: Doc): boolean {
  const sent = data.ai
  const stored = originalDoc.ai
  if (!sent) return false
  const at = text(sent.enrichedAt) as string | null
  const storedAt = text(stored?.enrichedAt) as string | null
  if ('enrichedAt' in sent && (at || storedAt) && !sameInstant(at, storedAt)) return true
  if ('enrichedHash' in sent && text(sent.enrichedHash) !== text(stored?.enrichedHash)) return true
  return 'promptHash' in sent && text(sent.promptHash) !== text(stored?.promptHash)
}

/** Drops the AI-managed values of a stale save, so the stored ones (from the newer enrichment) stay. */
function withoutAiManaged(data: Doc): Doc {
  const rest: Doc = { ...data }
  delete rest.category
  delete rest._h_tags
  const ai = { ...(data.ai ?? {}) } as Record<string, unknown>
  for (const key of AI_KEYS) delete ai[key]
  return { ...rest, ai: ai as Doc['ai'] }
}

/**
 * Spec §5.3: a misleading AI value is "corrected by editing and locking the field". An admin's edit of an
 * AI-managed field locks it in the same save, so the next enrichment cannot undo the correction. Only fields whose
 * value actually changed lock. Saves without an admin user (sync, enrichment, seed) never lock, and neither do
 * writes carrying a system context. Toggling a lock explicitly in the same save wins.
 */
export const lockAdminEditedAiFields: CollectionBeforeChangeHook<Plugin> = ({ data, originalDoc, operation, req, context }) => {
  if (operation !== 'update' || !originalDoc || !isAdminUser(req.user)) return data
  if (context.enrichment || context.syncTrash) return data
  // A stale form (opened before an enrichment landed) would revert the AI output and lock the old values for good.
  // Its other edits (visibility, customTagline, …) still save; its AI-managed values are dropped, nothing locks.
  if (predatesEnrichment(data, originalDoc)) {
    req.payload.logger.info(`Plugin ${originalDoc.id}: the edit form predates the last enrichment; kept the AI-managed values.`)
    return withoutAiManaged(data)
  }
  const locks = { ...(originalDoc.locks ?? {}), ...(data.locks ?? {}) }
  let changed = false
  for (const key of Object.keys(FIELDS) as LockKey[]) {
    const field = FIELDS[key]
    if (!field.present(data) || locks[key]) continue
    if (JSON.stringify(field.value(data)) === JSON.stringify(field.value(originalDoc))) continue
    const toggledNow = data.locks?.[key] !== undefined && Boolean(data.locks[key]) !== Boolean(originalDoc.locks?.[key])
    if (toggledNow) continue
    locks[key] = true
    changed = true
  }
  return changed ? { ...data, locks } : data
}
