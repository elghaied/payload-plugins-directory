import type { Plugin } from '@/payload-types'

/** What sync stores when neither package.json nor GitHub has a description. Never shown as the author's words. */
export const NO_DESCRIPTION = 'No description available'

/** The author's own description, or '' when there is none (empty, or sync's placeholder). */
export const authorDescriptionOf = (description: string | null | undefined): string => {
  const text = description?.trim() ?? ''
  return text === NO_DESCRIPTION ? '' : text
}

/** Display precedence (spec §3.1): claimed maintainer's customTagline → AI tagline → author description. */
export function pluginTagline(doc: Partial<Pick<Plugin, 'customTagline' | 'ai' | 'description'>>): string {
  return doc.customTagline?.trim() || doc.ai?.tagline?.trim() || doc.description?.trim() || ''
}
