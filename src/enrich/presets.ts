import type { Where } from 'payload'

/** Spec §5.4: results below this confidence appear in the "Low confidence" admin view; nothing is blocked. */
export const LOW_CONFIDENCE = 0.6

export const LOW_CONFIDENCE_WHERE: Where = { 'ai.confidence': { less_than: LOW_CONFIDENCE } }
/** "Uncategorized" is not a category: it is a plugin whose category is empty (spec §3.1). */
export const UNCATEGORIZED_WHERE: Where = { category: { exists: false } }
export const FAILED_WHERE: Where = { 'ai.failedAt': { exists: true } }

/** Shared admin list presets for `plugins` (spec §9), stored in the admin's own filter shape (or → and). */
export const AI_PRESETS: readonly { title: string; where: Where }[] = [
  { title: 'Low confidence', where: { or: [{ and: [LOW_CONFIDENCE_WHERE] }] } },
  { title: 'Uncategorized', where: { or: [{ and: [UNCATEGORIZED_WHERE] }] } },
  { title: 'Enrichment failed', where: { or: [{ and: [FAILED_WHERE] }] } },
]
