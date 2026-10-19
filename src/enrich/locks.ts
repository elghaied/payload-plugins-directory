import type { CollectionBeforeChangeHook } from 'payload'
import { isAdminUser } from '@/access'
import type { Plugin } from '@/payload-types'
import { relId } from '@/sync/util'

type LockKey = 'category' | 'tags' | 'tagline' | 'summary' | 'features' | 'useCases'
type Doc = Partial<Plugin>

const tagIds = (v: unknown): number[] =>
  (Array.isArray(v) ? v : [])
    .map((t) => relId(t as number | { id: number }))
    .filter((id): id is number => id !== null)
    .sort((a, b) => a - b)

/** How to read each AI-managed value, and whether this save contains it at all. */
const FIELDS: Record<LockKey, { value: (d: Doc) => unknown; present: (d: Doc) => boolean }> = {
  category: { value: (d) => relId(d.category as never), present: (d) => 'category' in d },
  tags: { value: (d) => tagIds(d._h_tags), present: (d) => '_h_tags' in d },
  tagline: { value: (d) => d.ai?.tagline ?? null, present: (d) => Boolean(d.ai && 'tagline' in d.ai) },
  summary: { value: (d) => d.ai?.summary ?? null, present: (d) => Boolean(d.ai && 'summary' in d.ai) },
  features: { value: (d) => d.ai?.features ?? [], present: (d) => Boolean(d.ai && 'features' in d.ai) },
  useCases: { value: (d) => d.ai?.useCases ?? [], present: (d) => Boolean(d.ai && 'useCases' in d.ai) },
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
