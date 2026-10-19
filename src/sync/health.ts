export type HealthInput = {
  isArchived: boolean
  pushedAt: string | null
  stars: number
  openIssues: number
  license: string | null
  isOfficial: boolean
  npm?: { weeklyDownloads: number; lastPublish: string | null; dependencyCount: number; unpackedSize: number | null }
}

export type HealthRepo = {
  isArchived?: boolean | null
  pushedAt?: string | null
  stars?: number | null
  openIssues?: number | null
  license?: string | null
}

export type StoredNpm =
  | {
      weeklyDownloads?: number | null
      latestVersion?: string | null
      unpackedSize?: number | null
      lastPublish?: string | null
      dependencyCount?: number | null
    }
  | null
  | undefined

const DAY_MS = 86_400_000

/** Health score 0–100: the formula of scripts/fetch-plugins.ts, unchanged. */
export function computeHealthScore(p: HealthInput, now: Date): number {
  if (p.isArchived) return 0
  const daysSince = (iso: string | null) => (iso ? (now.getTime() - new Date(iso).getTime()) / DAY_MS : Number.NaN)
  let score = 0

  // GitHub recency (max 20)
  const pushed = daysSince(p.pushedAt)
  if (pushed < 30) score += 20
  else if (pushed < 90) score += 15
  else if (pushed < 180) score += 10
  else if (pushed < 365) score += 5

  // Star popularity, log scale (max 15)
  if (p.stars > 0) score += Math.round(Math.min(Math.log10(p.stars) / Math.log10(1000), 1) * 15)

  // Low issue ratio (max 10)
  if (p.stars > 0) {
    const ratio = p.openIssues / p.stars
    if (ratio < 0.05) score += 10
    else if (ratio < 0.1) score += 7
    else if (ratio < 0.2) score += 4
  } else if (p.openIssues === 0) {
    score += 10
  }

  // Has a license (max 5)
  if (p.license) score += 5

  if (p.npm) {
    // Weekly downloads, log scale (max 20)
    if (p.npm.weeklyDownloads > 0) score += Math.round(Math.min(Math.log10(p.npm.weeklyDownloads) / Math.log10(10_000), 1) * 20)
    // npm publish recency (max 15)
    if (p.npm.lastPublish) {
      const published = daysSince(p.npm.lastPublish)
      if (published < 30) score += 15
      else if (published < 90) score += 12
      else if (published < 180) score += 8
      else if (published < 365) score += 4
    }
    // Few dependencies (max 10)
    if (p.npm.dependencyCount <= 3) score += 10
    else if (p.npm.dependencyCount <= 8) score += 7
    else if (p.npm.dependencyCount <= 15) score += 4
    // Small package (max 5)
    if (p.npm.unpackedSize !== null) {
      if (p.npm.unpackedSize < 50 * 1024) score += 5
      else if (p.npm.unpackedSize < 200 * 1024) score += 3
      else if (p.npm.unpackedSize < 1024 * 1024) score += 1
    }
  }

  if (p.isOfficial) score += 5
  return Math.min(score, 100)
}

/** Stored npm group -> score input. The group always exists on a plugin; it counts only once npm data was assigned. */
export function npmForHealth(npm: StoredNpm): HealthInput['npm'] {
  if (!npm?.latestVersion) return undefined
  return {
    weeklyDownloads: npm.weeklyDownloads ?? 0,
    lastPublish: npm.lastPublish ?? null,
    dependencyCount: npm.dependencyCount ?? 0,
    unpackedSize: npm.unpackedSize ?? null,
  }
}

/**
 * Score input from a repository and a plugin. `ignoreIssues` keeps the legacy behaviour for packages of the
 * official monorepo, whose issue count belongs to all of Payload rather than to one plugin.
 */
export function healthInputFrom(
  repo: HealthRepo,
  plugin: { isOfficial?: boolean | null; npm?: StoredNpm; ignoreIssues?: boolean },
): HealthInput {
  return {
    isArchived: Boolean(repo.isArchived),
    pushedAt: repo.pushedAt ?? null,
    stars: repo.stars ?? 0,
    openIssues: plugin.ignoreIssues ? 0 : (repo.openIssues ?? 0),
    license: repo.license ?? null,
    isOfficial: Boolean(plugin.isOfficial),
    npm: npmForHealth(plugin.npm),
  }
}

/** The one way to compute a stored plugin's score: every caller (sync-repository, npm-stats, ...) uses this. */
export function scoreFor(
  repo: HealthRepo,
  plugin: { isOfficial?: boolean | null; npm?: StoredNpm; ignoreIssues?: boolean },
  now: Date,
): number {
  return computeHealthScore(healthInputFrom(repo, plugin), now)
}
