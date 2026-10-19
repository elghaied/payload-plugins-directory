import type { Payload } from 'payload'
import type { Plugin } from '@/payload-types'
import { revalidationTagsFor } from '@/lib/cacheTags'
import { payloadMajorsFromRange } from '@/lib/versions'
import type { SyncContext } from './context'
import { scoreFor } from './health'
import { RateLimitError } from './http'
import type { NpmPackageInfo } from './npm'
import { isValidPackageName, normalizeGitHubUrl } from './packages'
import { relId, sameInstant } from './util'

export type NpmStatsInput = { slugs?: string[] | null }
export type NpmStatsResult = {
  checked: number
  updated: string[]
  /** Number of package lookups that failed transiently. */
  errors: number
  /** Slugs whose lookup failed; they keep their previous npm fields and health. */
  failed: string[]
  revalidateTags: string[]
}

const BATCH = 10
type StoredNpm = NonNullable<Plugin['npm']>

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

type Fetched = { info: NpmPackageInfo | null; failed: boolean }

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
  const targets = all.filter((p) => isValidPackageName(p.packageName) && (!wanted || wanted.has(p.slug)))
  const repoIds = [...new Set(targets.map((t) => relId(t.repository)).filter((id): id is number => id !== null))]
  const repos = new Map(
    repoIds.length
      ? (await payload.find({ collection: 'repositories', overrideAccess: true, depth: 0, limit: 0, pagination: false, where: { id: { in: repoIds } } })).docs.map((r) => [r.id, r])
      : [],
  )
  const names = [...new Set(targets.map(key))]
  const result: NpmStatsResult = { checked: 0, updated: [], errors: 0, failed: [], revalidateTags: [] }

  for (let i = 0; i < names.length; i += BATCH) {
    let fetched: (readonly [string, Fetched])[]
    try {
      fetched = await Promise.all(
        names.slice(i, i + BATCH).map(async (name) => {
          try {
            return [name, { info: await ctx.npm.getPackage(name), failed: false }] as const
          } catch (err) {
            if (err instanceof RateLimitError) throw err
            return [name, { info: null, failed: true }] as const // transient: this package keeps its previous data
          }
        }),
      )
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
        const repo = repos.get(relId(p.repository) ?? -1)
        const owns =
          (shared.get(name) ?? 0) <= 1 || (repo !== undefined && normalizeGitHubUrl(info?.repositoryUrl) === repo.fullName.toLowerCase())
        const fresh = info && owns ? toStoredNpm(info) : null
        const npm = fresh ?? p.npm
        const npmChanged = Boolean(fresh && !sameNpm(p.npm, fresh))
        const payloadMajors = payloadMajorsFromRange(p.payloadVersionRange ?? null, npm?.latestVersion ?? null)
        const healthScore = scoreFor(repo ?? {}, { isOfficial: p.isOfficial, npm, ignoreIssues: p.source === 'official' }, now)
        const majorsChanged = !sameSet(p.payloadMajors, payloadMajors)
        const healthChanged = healthScore !== p.healthScore
        if (!npmChanged && !majorsChanged && !healthChanged) continue
        await payload.update({
          collection: 'plugins',
          id: p.id,
          overrideAccess: true,
          depth: 0,
          data: {
            ...(npmChanged && fresh ? { npm: fresh } : {}),
            ...(majorsChanged ? { payloadMajors } : {}),
            ...(healthChanged ? { healthScore } : {}),
          },
        })
        result.updated.push(p.slug)
      }
    }
  }

  result.revalidateTags = revalidationTagsFor(result.updated)
  return result
}
