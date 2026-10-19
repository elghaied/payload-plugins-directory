import type { Plugin } from '@/payload-types'

/** Display precedence (spec §3.1): claimed maintainer's customTagline → AI tagline → author description. */
export function pluginTagline(doc: Partial<Pick<Plugin, 'customTagline' | 'ai' | 'description'>>): string {
  return doc.customTagline?.trim() || doc.ai?.tagline?.trim() || doc.description?.trim() || ''
}
