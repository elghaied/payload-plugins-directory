import { toSummary } from '@/lib/directory/mappers'
import type { PluginSummary } from '@/lib/directory/types'
import { templateTagline } from '@/lib/templates/mappers'
import { effectiveStack } from '@/lib/templates/stack'
import type { TemplateSummary } from '@/lib/templates/types'
import type { DirectorySearch } from './searchDirectory'

export type SiteSearchResult = {
  status: DirectorySearch['status']
  query: string
  truncated: boolean
  /** More matches exist than the shown page. */
  hasMore: boolean
  /** The query was too short to search (the search layer ran no query). */
  tooShort: boolean
  /** `description` is the display tagline (customTagline, then AI tagline, then author description). */
  plugins: PluginSummary[]
  /** Display tagline: customTagline, then AI tagline, then the author description. */
  templates: SiteTemplateResult[]
  categories: { slug: string; title: string; path: string }[]
  tags: { slug: string; title: string }[]
}

export type SiteTemplateResult = Pick<TemplateSummary, 'slug' | 'name' | 'tagline' | 'isOfficial' | 'stack'>

/** Page view model. `null` only for a blank query with nothing wrong; a timeout or busy status is always returned. */
export function toSiteResult(result: DirectorySearch): SiteSearchResult | null {
  if (!result.query && result.status === 'ok') return null
  const text = result.query?.text ?? ''
  return {
    status: result.status,
    query: text,
    truncated: result.query?.truncated ?? false,
    hasMore: result.hasMore,
    tooShort: Array.from(text).length < 2,
    plugins: result.plugins.map((doc) => toSummary(doc)),
    templates: result.templates.map((t) => ({
      slug: t.slug,
      name: t.name,
      tagline: templateTagline(t),
      isOfficial: Boolean(t.isOfficial),
      stack: effectiveStack(t),
    })),
    categories: result.categories.map((c) => {
      // Ruling F1: no slug fallback; the search read requests _h_slugPath.
      if (!c._h_slugPath) throw new Error(`Category "${c.slug}" was loaded without _h_slugPath`)
      return { slug: c.slug, title: c.title, path: c._h_slugPath }
    }),
    tags: result.tags.map((t) => ({ slug: t.slug, title: t.title })),
  }
}
