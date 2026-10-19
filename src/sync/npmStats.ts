import type { Payload } from 'payload'
import type { Plugin } from '@/payload-types'
import { revalidationTagsFor } from '@/lib/cacheTags'
import { payloadMajorsFromRange } from '@/lib/versions'
import type { SyncContext } from './context'
import { InvalidGitHubPathError } from './github'
import { scoreFor } from './health'
import { HttpError, RateLimitError } from './http'
import { InvalidNpmPackageNameError, type NpmPackageInfo } from './npm'
import { isValidPackageName, normalizeGitHubUrl } from './packages'
import { relId, sameInstant } from './util'

export type NpmStatsInput = { slugs?: string[] | null }
export type NpmStatsResult = {
  checked: number
  updated: string[]
  /** Failed package lookups, invalid package names and failed plugin updates (one per slug or package). */
  errors: number
  /** Slugs whose lookup failed; they keep their previous npm fields and health. */
  failed: string[]
  /** Slugs whose package belongs to another repository (or is ambiguous); their npm fields were cleared. */
  mismatched: string[]
  revalidateTags: string[]
}

const BATCH = 10
type StoredNpm = NonNullable<Plugin['npm']>
const EMPTY_NPM: StoredNpm = { weeklyDownloads: null, monthlyDownloads: null, latestVersion: null, unpackedSize: null, lastPublish: null, dependencyCount: null }

const key = (p: { packageName?: string | null }) => (p.packageName ?? '').toLowerCase()

function toStoredNpm(info: NpmPackageInfo): StoredNpm {
  const d = info.data
  return {
    weeklyDownloads: d.weeklyDownloads,
    monthlyDownloads: d.monthlyDownloads,
    latestVersion: d.latestVersion,
    unpackedSize: d.unpackedSize,
    lastPublish: d.lastPublish || null,
    dependencyCount: d.dependencyCount,
  }
}

function sameNpm(a: Plugin['npm'], b: StoredNpm): boolean {
  return (
    (a?.weeklyDownloads ?? null) === (b.weeklyDownloads ?? null) &&
    (a?.monthlyDownloads ?? null) === (b.monthlyDownloads ?? null) &&
    (a?.latestVersion ?? null) === (b.latestVersion ?? null) &&
    (a?.unpackedSize ?? null) === (b.unpackedSize ?? null) &&
    (a?.dependencyCount ?? null) === (b.dependencyCount ?? null) &&
    ((a?.lastPublish ?? null) === (b.lastPublish ?? null) || sameInstant(a?.lastPublish, b.lastPublish))
  )
}

const sameSet = (a: readonly string[] | null | undefined, b: readonly string[]) =>
  [...(a ?? [])].sort().join() === [...b].sort().join()

/** Failures that leave a package's data as it was: HTTP errors, fetch network errors (TypeError), timeouts. Anything else is a bug and propagates. */
const isTransient = (err: unknown): boolean =>
  err instanceof HttpError ||
  err instanceof InvalidNpmPackageNameError ||
  err instanceof TypeError ||
  (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError'))

type Fetched = { info: NpmPackageInfo | null; failed: boolean }
/** GitHub id a registry `owner/repo` resolves to; null = no such repository (404, invalid name); 'error' = lookup failed. */
type RegistryRepoId = number | null | 'error'

export async function runNpmStats(payload: Payload, input: NpmStatsInput, ctx: SyncContext): Promise<NpmStatsResult> {
  const now = ctx.now()
  const all = (
    await payload.find({
      collection: 'plugins',
      overrideAccess: true,
      depth: 0,
      limit: 0,
      pagination: false,
      select: { slug: true, packageName: true, payloadVersionRange: true, payloadMajors: true, npm: true, repository: true, isOfficial: true, source: true, healthScore: true },
    })
  ).docs

  // How many active plugins claim each package name, across the whole directory (not just this run's slugs).
  const shared = new Map<string, number>()
  for (const p of all) if (isValidPackageName(p.packageName)) shared.set(key(p), (shared.get(key(p)) ?? 0) + 1)

  const wanted = input.slugs?.length ? new Set(input.slugs) : null
  const inScope = all.filter((p) => !wanted || wanted.has(p.slug))
  const targets = inScope.filter((p) => isValidPackageName(p.packageName))
  const repoIds = [...new Set(targets.map((t) => relId(t.repository)).filter((id): id is number => id !== null))]
  const repos = new Map(
    repoIds.length
      ? (await payload.find({ collection: 'repositories', overrideAccess: true, depth: 0, limit: 0, pagination: false, where: { id: { in: repoIds } } })).docs.map((r) => [r.id, r])
      : [],
  )
  const names = [...new Set(targets.map(key))]
  const repoOf = (p: (typeof targets)[number]) => repos.get(relId(p.repository) ?? -1)

  // The registry may still name a repository's old full name (renamed or transferred): resolve it on GitHub and
  // compare GitHub ids. One lookup per name per run; a RateLimitError propagates (the run is re-queued).
  const registryIds = new Map<string, RegistryRepoId>()
  async function resolveRegistryRepo(fullName: string): Promise<void> {
    if (registryIds.has(fullName)) return
    let id: RegistryRepoId
    try {
      id = (await ctx.github.getRepo({ fullName }))?.id ?? null
    } catch (err) {
      if (err instanceof InvalidGitHubPathError) id = null
      else if (isTransient(err)) id = 'error'
      else throw err
    }
    registryIds.set(fullName, id)
  }
  const result: NpmStatsResult = { checked: 0, updated: [], errors: 0, failed: [], mismatched: [], revalidateTags: [] }
  // A package name was set but is not a valid npm name: nothing can be fetched, so report it.
  for (const p of inScope) {
    if (p.packageName && !isValidPackageName(p.packageName)) {
      result.errors++
      result.failed.push(p.slug)
    }
  }

  for (let i = 0; i < names.length; i += BATCH) {
    let fetched: (readonly [string, Fetched])[]
    try {
      fetched = await Promise.all(
        names.slice(i, i + BATCH).map(async (name) => {
          try {
            return [name, { info: await ctx.npm.getPackage(name), failed: false }] as const
          } catch (err) {
            if (!isTransient(err)) throw err // includes RateLimitError
            return [name, { info: null, failed: true }] as const // transient: this package keeps its previous data
          }
        }),
      )
      // Ownership lookups for this batch, before any write, so a rate limit re-queues it unchanged.
      for (const [name, { info }] of fetched) {
        const registryRepo = normalizeGitHubUrl(info?.repositoryUrl)
        if (!registryRepo) continue
        const needsLookup = targets.some((t) => key(t) === name && repoOf(t)?.githubId != null && repoOf(t)?.fullName.toLowerCase() !== registryRepo)
        if (needsLookup) await resolveRegistryRepo(registryRepo)
      }
    } catch (err) {
      if (err instanceof RateLimitError) {
        const remaining = new Set(names.slice(i))
        throw err.withRequeueInput({ slugs: targets.filter((t) => remaining.has(key(t))).map((t) => t.slug) })
      }
      throw err
    }

    for (const [name, { info, failed }] of fetched) {
      result.checked++
      const group = targets.filter((t) => key(t) === name)
      if (failed) {
        result.errors++
        result.failed.push(...group.map((p) => p.slug))
        continue
      }
      for (const p of group) {
        const repo = repoOf(p)
        let fresh: StoredNpm | null = null
        if (info) {
          const declared = Boolean(info.repositoryUrl?.trim())
          const registryRepo = normalizeGitHubUrl(info.repositoryUrl)
          // Data belongs to the plugin only if the registry says the package lives in this plugin's repository:
          // same full name, or (renamed / transferred repository) a full name GitHub resolves to the same id.
          // Without a repository field it is accepted only when no other plugin uses the name (legacy behaviour).
          // A declared non-GitHub repository can never be a listed plugin's.
          const registryId = registryRepo !== null && registryRepo !== repo?.fullName.toLowerCase() ? registryIds.get(registryRepo) : undefined
          if (registryId === 'error') {
            // Ownership unknown (transient GitHub failure): keep the previous data.
            result.errors++
            result.failed.push(p.slug)
            continue
          }
          const owns = declared
            ? registryRepo !== null &&
              (registryRepo === repo?.fullName.toLowerCase() || (repo?.githubId != null && registryId === repo.githubId))
            : (shared.get(name) ?? 0) <= 1
          if (owns) fresh = toStoredNpm(info)
          else {
            fresh = { ...EMPTY_NPM } // an impostor must not keep numbers it was given earlier
            result.mismatched.push(p.slug)
          }
        }
        const npm = fresh ?? p.npm
        const npmChanged = Boolean(fresh && !sameNpm(p.npm, fresh))
        const payloadMajors = payloadMajorsFromRange(p.payloadVersionRange ?? null, npm?.latestVersion ?? null)
        const healthScore = scoreFor(repo ?? {}, { isOfficial: p.isOfficial, npm, ignoreIssues: p.source === 'official' }, now)
        const majorsChanged = !sameSet(p.payloadMajors, payloadMajors)
        const healthChanged = healthScore !== p.healthScore
        if (!npmChanged && !majorsChanged && !healthChanged) continue
        try {
          await payload.update({
            collection: 'plugins',
            id: p.id,
            overrideAccess: true,
            depth: 0,
            context: { skipRevalidate: true },
            data: {
              ...(npmChanged && fresh ? { npm: fresh } : {}),
              ...(majorsChanged ? { payloadMajors } : {}),
              ...(healthChanged ? { healthScore } : {}),
            },
          })
          result.updated.push(p.slug)
        } catch (err) {
          if (err instanceof RateLimitError) throw err
          result.errors++
          result.failed.push(p.slug)
        }
      }
    }
  }

  result.revalidateTags = revalidationTagsFor(result.updated)
  return result
}
