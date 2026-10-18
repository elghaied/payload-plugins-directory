import type { PayloadMajor } from '@/lib/versions'

export type PluginSummary = {
  slug: string
  name: string
  packageName?: string
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
}

export type PluginDetail = PluginSummary & {
  readme?: string
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
