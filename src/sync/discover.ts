import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import { revalidationTagsFor } from '@/lib/cacheTags'
import type { SyncContext } from './context'
import { OFFICIAL_REPO } from './extract'
import { HttpError } from './http'
import type { NpmClient } from './npm'
import { normalizeGitHubUrl, parseGitHubFullName, parseNpmPackageName } from './packages'
import type { SyncRepositoryInput } from './syncRepository'
import { trashPlugins } from './trash'
import { relId } from './util'

export const MAX_MISSED_DISCOVERIES = 3
export const DISCOVER_GUARD_RATIO = 0.5
/** Marker sync-repository puts in the full name of a row whose name another repository took. */
const STALE_MARKER = '~stale-'

export type DiscoverResult = {
  discovered: number
  /** Known repositories (with a listed plugin) the topic search is expected to return; the guard's denominator. */
  known: number
  /** How many of those the topic search returned. */
  knownSeen: number
  guardTripped: boolean
  warning: string | null
  toSync: SyncRepositoryInput[]
  missed: string[]
  trashed: string[]
  revalidateTags: string[]
}

type StoredRepo = { id: number; fullName: string; githubId?: number | null; missedDiscoveries?: number | null }

/**
 * Compare-and-set of `missedDiscoveries` in one statement: false when another discovery run changed the counter
 * since this run read it, so overlapping runs never count the same miss twice or trash twice.
 */
async function setMissedDiscoveries(payload: Payload, r: StoredRepo, next: number, now: Date): Promise<boolean> {
  const prev = r.missedDiscoveries ?? 0
  const res = await payload.db.drizzle.execute(sql`
    update "repositories" set "missed_discoveries" = ${next}, "updated_at" = ${now.toISOString()}
    where "id" = ${r.id} and coalesce("missed_discoveries", 0) = ${prev}
    returning "id"`)
  return res.rows.length > 0
}

/** Repositories of approved listing submissions: GitHub URLs directly, npm URLs via the registry's repository field. */
async function approvedSubmissionRepos(payload: Payload, npm: NpmClient): Promise<string[]> {
  const subs = await payload.find({
    collection: 'submissions',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    where: { and: [{ type: { equals: 'listing' } }, { status: { equals: 'approved' } }] },
  })
  const names: string[] = []
  for (const sub of subs.docs) {
    if (!sub.url) continue
    const fromGitHub = parseGitHubFullName(sub.url)
    if (fromGitHub) {
      names.push(fromGitHub)
      continue
    }
    const packageName = parseNpmPackageName(sub.url)
    if (!packageName) continue
    try {
      const fullName = normalizeGitHubUrl((await npm.getPackage(packageName))?.repositoryUrl)
      if (fullName) names.push(fullName)
    } catch (err) {
      if (!(err instanceof HttpError)) throw err // rate limits propagate; a broken npm entry only skips this submission
    }
  }
  return names
}

export async function runDiscover(payload: Payload, ctx: SyncContext): Promise<DiscoverResult> {
  const now = ctx.now()
  const search = await ctx.github.searchTopicRepos()
  const submitted = await approvedSubmissionRepos(payload, ctx.npm)

  const repos: StoredRepo[] = (
    await payload.find({
      collection: 'repositories',
      overrideAccess: true,
      depth: 0,
      limit: 0,
      pagination: false,
      select: { fullName: true, githubId: true, missedDiscoveries: true },
    })
  ).docs
  const byName = new Map<string, StoredRepo>()
  for (const r of repos) if (!byName.has(r.fullName.toLowerCase())) byName.set(r.fullName.toLowerCase(), r)

  // Found set, keyed by lower-cased full name. Search results carry their GitHub id.
  const found = new Map<string, SyncRepositoryInput>()
  const foundIds = new Set<number>()
  for (const repo of search.repos) {
    const key = repo.full_name.toLowerCase()
    found.set(key, { fullName: repo.full_name, githubId: repo.id, source: key === OFFICIAL_REPO ? 'official' : 'topic', discovered: true })
    foundIds.add(repo.id)
  }
  const searchIds = new Set(foundIds)
  const searchNames = new Set(found.keys())
  // Name-only entries (official monorepo, submissions) take the GitHub id of the stored row of that name, if any.
  // Edge case: if that name was recycled (the stored repository was renamed and a new one took the name), the job
  // syncs the stored repository by id, which renames its row; the next run then finds no stored row under the
  // name and queues it by name, so the newcomer is picked up one run later.
  const addByName = (fullName: string, source: 'official' | 'submission') => {
    const key = fullName.toLowerCase()
    if (found.has(key)) return
    const githubId = byName.get(key)?.githubId ?? null
    if (githubId != null) {
      if (foundIds.has(githubId)) return // the search already found that repository under its new name
      foundIds.add(githubId)
      found.set(key, { fullName, githubId, source, discovered: true })
    } else {
      found.set(key, { fullName, source, discovered: true })
    }
  }
  addByName(OFFICIAL_REPO, 'official')
  for (const fullName of submitted) addByName(fullName, 'submission')

  // Identity is the GitHub id; a full-name match counts only for rows without one (seeded).
  const isFound = (r: StoredRepo) => (r.githubId != null ? foundIds.has(r.githubId) : found.has(r.fullName.toLowerCase()))
  const isSeenBySearch = (r: StoredRepo) =>
    r.githubId != null ? searchIds.has(r.githubId) : searchNames.has(r.fullName.toLowerCase())

  const activePlugins = (
    await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, limit: 0, pagination: false, select: { repository: true } })
  ).docs
  const activeRepoIds = new Set(activePlugins.map((p) => relId(p.repository)))

  const knownRepos = repos.filter((r) => activeRepoIds.has(r.id))
  // The guard measures the topic search alone: repositories found only through a name-only entry (official
  // monorepo, submissions) are always "found", so counting them would let an empty search pass the guard.
  const expected = knownRepos.filter((r) => isSeenBySearch(r) || !isFound(r))
  const knownSeen = expected.filter(isSeenBySearch).length
  const belowRatio = expected.length > 0 && knownSeen < expected.length * DISCOVER_GUARD_RATIO
  const guardTripped = !search.complete || belowRatio
  const warning = guardTripped
    ? `Discovery saw ${knownSeen} of ${expected.length} known repositories${search.complete ? '' : ' (GitHub search results incomplete)'}; no repository was counted as missed or trashed.`
    : null

  const missedRepos = knownRepos.filter((r) => !isFound(r))
  const trashed: string[] = []
  const gone = new Set<number>()
  if (!guardTripped) {
    for (const r of repos) {
      if (isFound(r) && (r.missedDiscoveries ?? 0) > 0) await setMissedDiscoveries(payload, r, 0, now)
    }
    for (const r of missedRepos) {
      const missed = (r.missedDiscoveries ?? 0) + 1
      // Trashing restarts the count, so an admin restore gets a fresh window of misses instead of being undone
      // by the next run.
      const limitReached = missed >= MAX_MISSED_DISCOVERIES
      if (!(await setMissedDiscoveries(payload, r, limitReached ? 0 : missed, now))) continue // another run counted it
      if (limitReached) {
        trashed.push(...(await trashPlugins(payload, { repository: { equals: r.id } }, 'repository-gone', now)))
        gone.add(r.id)
      }
    }
  }

  // Follow-up checks (404 check and fresh stats, never a restore): missed known repositories that were not
  // trashed, plus every stale-renamed row that still has a listed plugin, so it is renamed back or found gone.
  // Stored rows go by GitHub id: a stale full name is not a valid GitHub name.
  const checks: SyncRepositoryInput[] = []
  const checkedIds = new Set<number>(foundIds)
  const check = (r: StoredRepo) => {
    if (r.githubId != null) {
      if (checkedIds.has(r.githubId)) return
      checkedIds.add(r.githubId)
    }
    checks.push({ fullName: r.fullName, githubId: r.githubId ?? null, source: 'topic', discovered: false })
  }
  for (const r of missedRepos) if (!gone.has(r.id)) check(r)
  for (const r of knownRepos) if (r.githubId != null && r.fullName.includes(STALE_MARKER) && !gone.has(r.id)) check(r)

  return {
    discovered: found.size,
    known: expected.length,
    knownSeen,
    guardTripped,
    warning,
    toSync: [...found.values(), ...checks],
    missed: guardTripped ? [] : missedRepos.map((r) => r.fullName).sort(),
    trashed: trashed.sort(),
    revalidateTags: revalidationTagsFor(trashed),
  }
}
