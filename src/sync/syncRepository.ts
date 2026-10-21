import type { Payload, Where } from 'payload'
import type { Plugin, Repository } from '@/payload-types'
import { revalidationTagsFor } from '@/lib/cacheTags'
import { payloadMajorsFromRange } from '@/lib/versions'
import { aliasTagIds, mergeTagIds, type AliasTag } from './aliasTags'
import { computeContentHash } from './contentHash'
import type { SyncContext } from './context'
import { extractOfficialPlugins, extractPlugins, OFFICIAL_REPO, type ExtractedPlugin } from './extract'
import type { GitHubRepo } from './github'
import { scoreFor } from './health'
import { clampExtracted, clampChars, DESCRIPTION_MAX_CHARS } from './limits'
import { InvalidNpmPackageNameError, type NpmClient } from './npm'
import { trashPlugins } from './trash'
import { sameIds, sameInstant } from './util'

export type SyncSource = 'topic' | 'official' | 'submission'

export type SyncRepositoryInput = {
  fullName: string
  githubId?: number | null
  source?: SyncSource | null
  /** false = a known repository discovery missed: checked for 404 and kept fresh, but never restored. */
  discovered?: boolean | null
}

export type SyncRepositoryResult = {
  status: 'synced' | 'gone'
  repositoryId: number | null
  contentReRead: boolean
  created: string[]
  updated: string[]
  restored: string[]
  trashed: string[]
  /**
   * Ids of active plugins whose freshly computed contentHash differs from `ai.enrichedHash` (absent counts as
   * different), so never-run or failed enrichment is retried: Phase 2 queues `enrich` for them.
   */
  contentChanged: number[]
  revalidateTags: string[]
}

/** Repository fields owned by sync. `missedDiscoveries` belongs to `discover` and is never written here. */
export function toRepositoryData(meta: GitHubRepo, isMonorepo: boolean, now: Date) {
  return {
    fullName: meta.full_name,
    githubId: meta.id,
    owner: meta.owner.login,
    ownerAvatar: meta.owner.avatar_url,
    url: meta.html_url,
    description: typeof meta.description === 'string' ? clampChars(meta.description, DESCRIPTION_MAX_CHARS) : null,
    stars: meta.stargazers_count,
    forks: meta.forks_count,
    openIssues: meta.open_issues_count,
    license: meta.license?.spdx_id || null,
    isArchived: meta.archived,
    pushedAt: meta.pushed_at,
    githubCreatedAt: meta.created_at,
    defaultBranch: meta.default_branch,
    topics: meta.topics ?? [],
    isMonorepo,
    lastSyncedAt: now.toISOString(),
  }
}

type RepositoryData = ReturnType<typeof toRepositoryData>

/**
 * Sync queues its own revalidation (result.revalidateTags); the Plugins hook must not queue a second job.
 * A fresh object per write: Payload v4 keeps the caller's context and hooks (plugin-search) write into it.
 */
const skipContext = () => ({ skipRevalidate: true })

const COMPARED = ['fullName', 'owner', 'ownerAvatar', 'description', 'stars', 'forks', 'openIssues', 'license', 'isArchived', 'defaultBranch'] as const

function repositoryChanged(prev: Repository | null, next: RepositoryData): boolean {
  if (!prev) return true
  if (COMPARED.some((k) => (prev[k] ?? null) !== (next[k] ?? null))) return true
  if (!sameInstant(prev.pushedAt, next.pushedAt)) return true
  return (prev.topics ?? []).join('\n') !== next.topics.join('\n')
}

async function repositoryWhere(payload: Payload, where: Where): Promise<Repository | null> {
  const res = await payload.find({ collection: 'repositories', overrideAccess: true, depth: 0, limit: 1, pagination: false, where })
  return res.docs[0] ?? null
}

type ResolvedRepository = {
  /** The row that is this repository: same githubId, or a seeded row (githubId null) with the same full name. */
  match: Repository | null
  /** Another repository's row (different, non-null githubId) holding this full name, e.g. after a rename. */
  stale: Repository | null
}

/**
 * Identity is the GitHub id. A full-name match is adopted only when the stored row has no githubId (seeded);
 * a row under the same name with another githubId belongs to a different repository and is never adopted.
 */
async function resolveRepository(payload: Payload, ref: { githubId?: number | null; fullName: string }): Promise<ResolvedRepository> {
  const byId = ref.githubId ? await repositoryWhere(payload, { githubId: { equals: ref.githubId } }) : null
  const byName = byId?.fullName === ref.fullName ? byId : await repositoryWhere(payload, { fullName: { equals: ref.fullName } })
  if (!byName || byName.id === byId?.id) return { match: byId, stale: null }
  if (byName.githubId == null) return { match: byId ?? byName, stale: null }
  if (!ref.githubId) return { match: byName, stale: null } // caller knows only the name: refresh that row by its own id
  return { match: byId, stale: byName.githubId === ref.githubId ? null : byName }
}

async function findPlugins(payload: Payload, where: Where): Promise<Plugin[]> {
  const res = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, depth: 0, limit: 0, pagination: false, where })
  return res.docs
}

async function loadAliasTags(payload: Payload): Promise<AliasTag[]> {
  const res = await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, limit: 0, pagination: false })
  return res.docs.map((t) => ({ id: t.id, aliases: t.aliases }))
}

/**
 * The alias tags merged into the plugin's tags as they are right now, or `null` when an admin locked its tags
 * (sync leaves them exactly as they are). Read just before the write, not at the start of the sync: an
 * enrichment applied in between would otherwise lose its AI tags (final review Minor 1).
 */
async function mergedTagsNow(payload: Payload, id: number, add: readonly number[]): Promise<number[] | null> {
  const now = await payload.findByID({
    collection: 'plugins', id, overrideAccess: true, trash: true, depth: 0, select: { _h_tags: true, locks: true },
  })
  return now.locks?.tags ? null : mergeTagIds(now._h_tags, add)
}

async function officialPackageNames(payload: Payload): Promise<Set<string>> {
  const docs = await findPlugins(payload, { source: { equals: 'official' } })
  return new Set(docs.flatMap((d) => (d.packageName ? [d.packageName.toLowerCase()] : [])))
}

/**
 * Latest npm versions for `workspace:*` packages (official monorepo) that have none stored yet, so their
 * Payload majors resolve on first sight. Remote reads: called before any database write.
 */
async function workspaceLatestVersions(
  npm: NpmClient,
  plugins: readonly ExtractedPlugin[],
  bySlug: ReadonlyMap<string, Plugin>,
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (const p of plugins) {
    if (!p.payloadVersionRange?.startsWith('workspace:') || !p.packageName) continue
    if (bySlug.get(p.slug)?.npm?.latestVersion) continue
    try {
      const info = await npm.getPackage(p.packageName)
      if (info) out.set(p.slug, info.data.latestVersion)
    } catch (error) {
      if (!(error instanceof InvalidNpmPackageNameError)) throw error
    }
  }
  return out
}

const sourceFor = (official: boolean, source?: SyncSource | null): SyncSource =>
  official ? 'official' : source === 'submission' ? 'submission' : 'topic'

export async function runSyncRepository(payload: Payload, input: SyncRepositoryInput, ctx: SyncContext): Promise<SyncRepositoryResult> {
  const now = ctx.now()
  const discovered = input.discovered !== false
  const result: SyncRepositoryResult = {
    status: 'synced', repositoryId: null, contentReRead: false,
    created: [], updated: [], restored: [], trashed: [], contentChanged: [], revalidateTags: [],
  }

  const { match: hint } = await resolveRepository(payload, { githubId: input.githubId, fullName: input.fullName })
  const meta = await ctx.github.getRepo({ githubId: input.githubId ?? hint?.githubId, fullName: input.fullName })
  if (!meta) {
    result.status = 'gone'
    if (hint) {
      result.repositoryId = hint.id
      result.trashed = await trashPlugins(payload, { repository: { equals: hint.id } }, 'repository-gone', now)
    }
    result.revalidateTags = revalidationTagsFor(result.trashed)
    return result
  }

  const resolved = await resolveRepository(payload, { githubId: meta.id, fullName: meta.full_name })
  // A seeded hint (no githubId) found under the requested name is adopted even if GitHub reports a newer name.
  const existing = resolved.match ?? (hint && (hint.githubId == null || hint.githubId === meta.id) ? hint : null)
  const stale = resolved.stale && resolved.stale.id !== existing?.id ? resolved.stale : null
  const official = meta.full_name.toLowerCase() === OFFICIAL_REPO
  const known = existing ? await findPlugins(payload, { repository: { equals: existing.id } }) : []
  // Incremental rule (spec §4): content is re-read only for a new / never-synced repository, a new push, or a
  // rediscovery after it was trashed as gone. Otherwise only repository metadata (and derived scores/tags) change.
  const needsContent =
    !existing ||
    !existing.lastSyncedAt ||
    !sameInstant(existing.pushedAt, meta.pushed_at) ||
    (discovered && known.some((p) => p.deletedAt && p.syncTrashReason === 'repository-gone'))

  // Every remote read happens before the first write (Review Focus 2): a RateLimitError thrown here leaves
  // the stored pushedAt untouched, so the re-queued job still sees the change and re-reads the content.
  const extraction = needsContent
    ? await (official ? extractOfficialPlugins(meta, ctx.github) : extractPlugins(meta, ctx.github))
    : null
  const slugs = extraction ? extraction.plugins.map((p) => p.slug) : []
  // Matched by slug across repositories and Trash: a slug never gets a second document.
  const bySlug = new Map((slugs.length ? await findPlugins(payload, { slug: { in: slugs } }) : []).map((d) => [d.slug, d]))
  const latestVersions = extraction ? await workspaceLatestVersions(ctx.npm, extraction.plugins, bySlug) : new Map<string, string>()

  const repoData = toRepositoryData(meta, extraction ? extraction.isMonorepo : Boolean(existing?.isMonorepo), now)
  const repoChanged = repositoryChanged(existing, repoData)

  // Free the unique full name held by another repository's row; its plugins are left to discovery.
  if (stale) {
    await payload.update({
      collection: 'repositories', id: stale.id, overrideAccess: true, depth: 0, context: skipContext(),
      data: { fullName: `${stale.fullName}~stale-${stale.githubId}` },
    })
  }
  // When content is re-read, pushedAt/lastSyncedAt advance only after every plugin write succeeded: if a write
  // below throws, the retried job still sees the push and re-reads the content instead of skipping it.
  const firstWrite = extraction
    ? { ...repoData, pushedAt: existing?.pushedAt ?? null, lastSyncedAt: existing?.lastSyncedAt ?? null }
    : repoData
  const repo = existing
    ? await payload.update({ collection: 'repositories', id: existing.id, overrideAccess: true, depth: 0, context: skipContext(), data: firstWrite })
    : await payload.create({ collection: 'repositories', overrideAccess: true, depth: 0, context: skipContext(), data: firstWrite })
  result.repositoryId = repo.id
  result.contentReRead = extraction !== null
  const aliasTags = await loadAliasTags(payload)

  if (extraction) {
    const officialNames = official ? new Set<string>() : await officialPackageNames(payload)
    const kept: string[] = []

    for (const extracted of extraction.plugins) {
      const p = clampExtracted(extracted)
      if (!official && p.packageName && officialNames.has(p.packageName.toLowerCase())) continue
      kept.push(p.slug)
      const prev = bySlug.get(p.slug)
      const contentHash = computeContentHash(p)
      const data = {
        name: p.name,
        packageName: p.packageName ?? null,
        repository: repo.id,
        path: p.path ?? null,
        url: p.url,
        isOfficial: p.isOfficial,
        description: p.description,
        keywords: p.keywords,
        readme: p.readme ?? null,
        contentHash,
        payloadVersionRange: p.payloadVersionRange,
        payloadMajors: payloadMajorsFromRange(p.payloadVersionRange, prev?.npm?.latestVersion ?? latestVersions.get(p.slug) ?? null),
        healthScore: scoreFor(repoData, { isOfficial: p.isOfficial, npm: prev?.npm, ignoreIssues: official }, now),
      }
      const aliasIds = aliasTagIds([...repoData.topics, ...p.keywords], aliasTags)
      if (!prev) {
        // Only creation sets visibility; admins own it afterwards (updates never write it).
        const doc = await payload.create({
          collection: 'plugins',
          overrideAccess: true,
          depth: 0,
          context: skipContext(),
          data: {
            ...data, _h_tags: aliasIds, slug: p.slug, source: sourceFor(official, input.source), visibility: 'listed', firstSeenAt: now.toISOString(),
          },
        })
        result.created.push(p.slug)
        result.contentChanged.push(doc.id)
        continue
      }
      // Only sync-trashed plugins come back, and only when discovery really found the repository again.
      const restore = discovered && Boolean(prev.deletedAt) && Boolean(prev.syncTrashReason)
      const tags = await mergedTagsNow(payload, prev.id, aliasIds)
      await payload.update({
        collection: 'plugins',
        id: prev.id,
        overrideAccess: true,
        trash: true,
        depth: 0,
        context: skipContext(),
        data: { ...data, ...(tags ? { _h_tags: tags } : {}), ...(restore ? { deletedAt: null, syncTrashReason: null } : {}) },
      })
      ;(restore ? result.restored : result.updated).push(p.slug)
      const active = restore || !prev.deletedAt
      if (active && (prev.ai?.enrichedHash ?? null) !== contentHash) result.contentChanged.push(prev.id)
    }

    const removed: Where = kept.length
      ? { and: [{ repository: { equals: repo.id } }, { slug: { not_in: kept } }] }
      : { repository: { equals: repo.id } }
    result.trashed = await trashPlugins(payload, removed, 'package-removed', now)
    await payload.update({
      collection: 'repositories', id: repo.id, overrideAccess: true, depth: 0, context: skipContext(),
      data: { pushedAt: repoData.pushedAt, lastSyncedAt: repoData.lastSyncedAt },
    })
  } else {
    const topicTagIds = aliasTagIds(repoData.topics, aliasTags)
    for (const p of known) {
      if (p.deletedAt) continue
      const healthScore = scoreFor(repoData, { isOfficial: p.isOfficial, npm: p.npm, ignoreIssues: p.source === 'official' }, now)
      const stale = p.locks?.tags ? null : mergeTagIds(p._h_tags, topicTagIds) // locked: never touched
      const staleChanged = stale !== null && !sameIds(stale, p._h_tags)
      if (healthScore === p.healthScore && !staleChanged) continue
      // Writing tags: merge into the stored set as it is now (an enrichment may have added AI tags since `known`).
      const tags = staleChanged ? await mergedTagsNow(payload, p.id, topicTagIds) : null
      const tagsChanged = tags !== null
      await payload.update({
        collection: 'plugins', id: p.id, overrideAccess: true, depth: 0, context: skipContext(),
        data: { healthScore, ...(tagsChanged ? { _h_tags: tags } : {}) },
      })
      result.updated.push(p.slug)
    }
  }

  const touched = new Set([...result.created, ...result.updated, ...result.restored, ...result.trashed])
  if (repoChanged) for (const p of known) if (!p.deletedAt) touched.add(p.slug)
  result.revalidateTags = revalidationTagsFor(touched)
  return result
}
