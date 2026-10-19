import type { Day } from './days'
import type { Coverage, Growth, Point } from './growth'

/** A plugin the public may see (read via access control), with the repository facts trends need. */
export type ListedPluginRef = {
  id: number
  slug: string
  name: string
  isOfficial: boolean
  firstSeenAt: string | null
  repository: {
    id: number
    fullName: string
    owner: string
    ownerAvatar: string
    pushedAt: string | null
    githubCreatedAt: string | null
  }
}

export type PluginLink = { slug: string; name: string }

/** Star growth is a repository fact: a monorepo appears once, with its listed plugins. */
export type StarMover = {
  repositoryId: number
  fullName: string
  owner: string
  ownerAvatar: string
  plugins: PluginLink[]
  growth: Growth
}

export type DownloadMover = {
  pluginId: number
  slug: string
  name: string
  owner: string
  ownerAvatar: string
  growth: Growth
}

export type NewPlugin = {
  slug: string
  name: string
  owner: string
  ownerAvatar: string
  addedOn: Day
  reason: 'new-repository' | 'newly-listed'
}

export type RecentRepo = {
  fullName: string
  owner: string
  ownerAvatar: string
  pushedAt: string
  plugins: PluginLink[]
}

export type TrendingData = {
  today: Day
  /** Latest snapshot day with data (stars or downloads); null when none. Pages say "Data as of <day>"; may be well before `today` if snapshots stopped. */
  lastSnapshotDay: Day | null
  starsCoverage: Coverage
  downloadsCoverage: Coverage
  /** False when coverage is ready but no listed entity has a snapshot about a week before the last day (missed runs). */
  starsComparable: boolean
  downloadsComparable: boolean
  stars: StarMover[]
  downloads: DownloadMover[]
  newThisMonth: NewPlugin[]
  recentlyUpdated: RecentRepo[]
}

export type PluginTrends = {
  stars: Point[]
  downloads: Point[]
  /** Set when the repository backs more than one listed plugin (its stars are shared). */
  sharedRepository: { fullName: string; pluginCount: number } | null
}

export type EcosystemGrowth = {
  stars: Point[]
  downloads: Point[]
  /** Latest day present in either series; null when both are empty. */
  lastSnapshotDay: Day | null
}
