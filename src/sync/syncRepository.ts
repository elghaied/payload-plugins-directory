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
    description: meta.description,
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

const COMPARED = ['fullName', 'owner', 'ownerAvatar', 'description', 'stars', 'forks', 'openIssues', 'license', 'isArchived', 'defaultBranch'] as const

function repositoryChanged(prev: Repository | null, next: RepositoryData): boolean {
  if (!prev) return true
  if (COMPARED.some((k) => (prev[k] ?? null) !== (next[k] ?? null))) return true
  if (!sameInstant(prev.pushedAt, next.pushedAt)) return true
  return (prev.topics ?? []).join('\n') !== next.topics.join('\n')
}

async function findRepository(payload: Payload, ref: { githubId?: number | null; fullName: string }): Promise<Repository | null> {
  const or: Where[] = [{ fullName: { equals: ref.fullName } }]
  if (ref.githubId) or.push({ githubId: { equals: ref.githubId } })
  const res = await payload.find({ collection: 'repositories', overrideAccess: true, depth: 0, limit: 2, where: { or } })
  // Prefer the githubId match: after a rename, the old full name may belong to nothing.
  return res.docs.find((d) => ref.githubId != null && d.githubId === ref.githubId) ?? res.docs[0] ?? null
}

async function findPlugins(payload: Payload, where: Where): Promise<Plugin[]> {
  const res = await payload.find({ collection: 'plugins', overrideAccess: true, trash: true, depth: 0, limit: 0, pagination: false, where })
  return res.docs
}

async function loadAliasTags(payload: Payload): Promise<AliasTag[]> {
  const res = await payload.find({ collection: 'tags', overrideAccess: true, depth: 0, limit: 0, pagination: false })
  return res.docs.map((t) => ({ id: t.id, aliases: t.aliases }))
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

  const hint = await findRepository(payload, { githubId: input.githubId, fullName: input.fullName })
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

  const existing = (await findRepository(payload, { githubId: meta.id, fullName: meta.full_name })) ?? hint
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
  const repo = existing
    ? await payload.update({ collection: 'repositories', id: existing.id, overrideAccess: true, depth: 0, data: repoData })
    : await payload.create({ collection: 'repositories', overrideAccess: true, depth: 0, data: repoData })
  result.repositoryId = repo.id
  result.contentReRead = extraction !== null
  const aliasTags = await loadAliasTags(payload)

  if (extraction) {
    const officialNames = official ? new Set<string>() : await officialPackageNames(payload)
    const kept: string[] = []

    for (const p of extraction.plugins) {
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
        readme: p.readme ?? null,
        contentHash,
        payloadVersionRange: p.payloadVersionRange,
        payloadMajors: payloadMajorsFromRange(p.payloadVersionRange, prev?.npm?.latestVersion ?? latestVersions.get(p.slug) ?? null),
        healthScore: scoreFor(repoData, { isOfficial: p.isOfficial, npm: prev?.npm, ignoreIssues: official }, now),
        _h_tags: mergeTagIds(prev?._h_tags, aliasTagIds([...repoData.topics, ...p.keywords], aliasTags)),
      }
      if (!prev) {
        // Only creation sets visibility; admins own it afterwards (updates never write it).
        const doc = await payload.create({
          collection: 'plugins',
          overrideAccess: true,
          depth: 0,
          data: { ...data, slug: p.slug, source: sourceFor(official, input.source), visibility: 'listed', firstSeenAt: now.toISOString() },
        })
        result.created.push(p.slug)
        result.contentChanged.push(doc.id)
        continue
      }
      // Only sync-trashed plugins come back, and only when discovery really found the repository again.
      const restore = discovered && Boolean(prev.deletedAt) && Boolean(prev.syncTrashReason)
      await payload.update({
        collection: 'plugins',
        id: prev.id,
        overrideAccess: true,
        trash: true,
        depth: 0,
        data: restore ? { ...data, deletedAt: null, syncTrashReason: null } : data,
      })
      ;(restore ? result.restored : result.updated).push(p.slug)
      const active = restore || !prev.deletedAt
      if (active && (prev.ai?.enrichedHash ?? null) !== contentHash) result.contentChanged.push(prev.id)
    }

    const removed: Where = kept.length
      ? { and: [{ repository: { equals: repo.id } }, { slug: { not_in: kept } }] }
      : { repository: { equals: repo.id } }
    result.trashed = await trashPlugins(payload, removed, 'package-removed', now)
  } else {
    const topicTagIds = aliasTagIds(repoData.topics, aliasTags)
    for (const p of known) {
      if (p.deletedAt) continue
      const healthScore = scoreFor(repoData, { isOfficial: p.isOfficial, npm: p.npm, ignoreIssues: p.source === 'official' }, now)
      const tags = mergeTagIds(p._h_tags, topicTagIds)
      if (healthScore === p.healthScore && sameIds(tags, p._h_tags)) continue
      await payload.update({ collection: 'plugins', id: p.id, overrideAccess: true, depth: 0, data: { healthScore, _h_tags: tags } })
      result.updated.push(p.slug)
    }
  }

  const touched = new Set([...result.created, ...result.updated, ...result.restored, ...result.trashed])
  if (repoChanged) for (const p of known) if (!p.deletedAt) touched.add(p.slug)
  result.revalidateTags = revalidationTagsFor(touched)
  return result
}
