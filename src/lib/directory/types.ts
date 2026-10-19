import type { PayloadMajor } from '@/lib/versions'

export type PluginSummary = {
  slug: string
  name: string
  packageName?: string
  /** Display tagline: customTagline → ai.tagline → author description (spec §3.1). */
  description: string
  owner: string
  ownerAvatar: string
  url: string
  repositoryUrl: string
  collection?: string
  stars: number
  forks: number
  openIssues: number
  lastUpdate: string
  createdAt: string
  topics: string[]
  isOfficial: boolean
  payloadMajors: PayloadMajor[]
  license: string | null
  isArchived: boolean
  weeklyDownloads?: number
  latestVersion?: string
  unpackedSize?: number | null
  healthScore?: number
  /** `_h_slugPath` of the plugin's category ("parent/child"); absent = Uncategorized. */
  categoryPath?: string
  /** Tag slugs; absent when the plugin has none. */
  tags?: string[]
}

export type PluginDetail = PluginSummary & {
  /** The author's own description (GitHub/npm), shown below the AI overview. */
  authorDescription: string
  /** The claimed maintainer's own tagline, shown in the detail header; absent when unset. */
  customTagline?: string
  /** Maintainer-uploaded logo (media URL); replaces the owner avatar in the detail header. */
  logoUrl?: string
  readme?: string
  /** Full README for the "Full README" disclosure; `readme` stays the short preview. */
  readmeFull?: string
  /** Plain strings only: render as text, never as HTML or markdown. */
  ai?: { summary?: string; features: string[]; useCases: string[]; generated: boolean }
  category?: { slug: string; title: string; path: string }
  tagList: { slug: string; title: string }[]
  payloadVersionRange: string | null
  npm?: {
    weeklyDownloads?: number | null
    monthlyDownloads?: number | null
    latestVersion?: string | null
    unpackedSize?: number | null
    lastPublish?: string | null
    dependencyCount?: number | null
  }
}
