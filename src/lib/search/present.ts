import { toSummary } from '@/lib/directory/mappers'
import type { PluginSummary } from '@/lib/directory/types'
import type { DirectorySearch } from './searchDirectory'

export type SiteSearchResult = {
  status: DirectorySearch['status']
  query: string
  truncated: boolean
  /** The query was too short to search (the search layer ran no query). */
  tooShort: boolean
  /** `description` is the display tagline (customTagline, then AI tagline, then author description). */
  plugins: PluginSummary[]
  categories: { slug: string; title: string; path: string }[]
  tags: { slug: string; title: string }[]
}

/** Page view model. `null` when there was no query at all (blank input) and nothing went wrong. */
export function toSiteResult(result: DirectorySearch): SiteSearchResult | null {
  if (!result.query) return null
  return {
    status: result.status,
    query: result.query.text,
    truncated: result.query.truncated,
    tooShort: Array.from(result.query.text).length < 2,
    plugins: result.plugins.map((doc) => toSummary(doc)),
    categories: result.categories.map((c) => {
      // Ruling F1: no slug fallback; the search read requests _h_slugPath.
      if (!c._h_slugPath) throw new Error(`Category "${c.slug}" was loaded without _h_slugPath`)
      return { slug: c.slug, title: c.title, path: c._h_slugPath }
    }),
    tags: result.tags.map((t) => ({ slug: t.slug, title: t.title })),
  }
}
