import { createHash } from 'node:crypto'
import type { Payload, Where } from 'payload'
import type { Repository, Template } from '@/payload-types'
import { templateRevalidationTagsFor } from '@/lib/cacheTags'
import { relationId } from '@/lib/relationId'
import { firstReadmeImage } from '@/lib/templates/fallbackImage'
import { payloadMajorsFromRange } from '@/lib/versions'
import type { SyncContext } from '../context'
import { OFFICIAL_REPO } from '../extract'
import type { GitHubRepo } from '../github'
import { clampExtractedTemplate } from '../limits'
import { InvalidNpmPackageNameError } from '../npm'
import { renderReadmeFor, resolveRepository, toRepositoryData } from '../syncRepository'
import { trashTemplates } from '../trash'
import { extractCommunityTemplate, extractOfficialTemplates, type ExtractedTemplate } from './extract'

export type TemplateSource = 'official' | 'submission' | 'converted'

export type SyncTemplateInput = { fullName: string; githubId?: number | null; path?: string | null; source: TemplateSource }

export type SyncTemplateResult = {
  status: 'synced' | 'gone' | 'conflict'
  created: string[]
  updated: string[]
  trashed: string[]
  /** Ids of active templates whose fresh contentHash differs from `ai.enrichedHash` (absent counts as different). */
  contentChanged: number[]
  revalidateTags: string[]
}

/**
 * Sync queues its own revalidation (result.revalidateTags); the Templates hooks must not queue more jobs.
 * A fresh object per write: Payload v4 keeps the caller's context and hooks write into it.
 */
const skipContext = () => ({ skipRevalidate: true })

const pathKey = (path: string | null | undefined) => path ?? ''

/** Hash of the author-controlled content template enrichment reads. */
export function templateContentHash(t: Pick<ExtractedTemplate, 'name' | 'description' | 'readme' | 'payloadVersionRange' | 'stack' | 'dependencyNames'>): string {
  const fields = [t.name, t.description, t.readme ?? null, t.payloadVersionRange ?? null, t.stack, t.dependencyNames]
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex')
}

/** Every template row with one of these slugs, across repositories and Trash: a slug never gets a second document. */
async function templatesBySlug(payload: Payload, slugs: string[]): Promise<Map<string, Template>> {
  if (!slugs.length) return new Map()
  const res = await payload.find({
    collection: 'templates', overrideAccess: true, trash: true, depth: 0, limit: 0, pagination: false, where: { slug: { in: slugs } },
  })
  return new Map(res.docs.map((d) => [d.slug, d]))
}

/** `(path ?? '')` of every non-trashed plugin of the repository: a path a plugin holds never becomes a template. */
async function pluginPaths(payload: Payload, repositoryId: number): Promise<Set<string>> {
  const res = await payload.find({
    collection: 'plugins', overrideAccess: true, depth: 0, limit: 0, pagination: false,
    where: { repository: { equals: repositoryId } }, select: { path: true },
  })
  return new Set(res.docs.map((p) => pathKey(p.path)))
}

/** Latest `payload` version on npm, read once per run and only when some template depends on `workspace:*`. */
async function latestPayloadVersion(ctx: SyncContext, templates: readonly ExtractedTemplate[]): Promise<string | null> {
  if (!templates.some((t) => t.payloadVersionRange?.startsWith('workspace:'))) return null
  try {
    return (await ctx.npm.getPackage('payload'))?.data.latestVersion ?? null
  } catch (error) {
    if (error instanceof InvalidNpmPackageNameError) return null
    throw error
  }
}

/**
 * Seam for Task 10 (`submissions.kind` / `submissions.template` do not exist yet): approved template submissions for
 * this repository and path get their `template` set after sync creates the template, the counterpart of the plugin
 * hook `linkApprovedSubmissions`. A no-op until Task 10 wires it.
 */
export async function linkApprovedTemplateSubmissions(
  payload: Payload,
  template: { id: number; repositoryFullName: string; path: string | null },
): Promise<void> {
  // TODO(Task 10): update approved `kind: 'template'` submissions of this repository + path that have no `template`.
  void payload
  void template
}

/**
 * Seam for Task 10: one input per approved template submission that has no `template` yet. Returns [] until the
 * `submissions.kind` field exists (Task 10 fills it in).
 */
export async function approvedTemplateSubmissionInputs(payload: Payload): Promise<SyncTemplateInput[]> {
  // TODO(Task 10): read approved `kind: 'template'` submissions without `template` and map them to inputs.
  void payload
  return []
}

/**
 * The repository row for a template sync. The official monorepo's row belongs to sync-repository: it is created
 * (never updated) here, only when missing. A community row is created or refreshed, but its `pushedAt` and
 * `lastSyncedAt` are never advanced on an existing row and a created row is never marked synced, so a plugin sync of
 * the same repository still sees a new push and re-reads its content.
 */
async function upsertRepository(
  payload: Payload,
  meta: GitHubRepo,
  official: boolean,
  existing: Repository | null,
  stale: Repository | null,
  now: Date,
): Promise<Repository> {
  if (official && existing) return existing
  if (stale) {
    // Free the unique full name held by another repository's row (as sync-repository does after a rename).
    await payload.update({
      collection: 'repositories', id: stale.id, overrideAccess: true, depth: 0, context: skipContext(),
      data: { fullName: `${stale.fullName}~stale-${stale.githubId}` },
    })
  }
  const data = toRepositoryData(meta, official || Boolean(existing?.isMonorepo), now)
  if (!existing) {
    return payload.create({ collection: 'repositories', overrideAccess: true, depth: 0, context: skipContext(), data: { ...data, lastSyncedAt: null } })
  }
  const metadata: Partial<typeof data> = { ...data }
  delete metadata.pushedAt
  delete metadata.lastSyncedAt
  delete metadata.isMonorepo
  return payload.update({ collection: 'repositories', id: existing.id, overrideAccess: true, depth: 0, context: skipContext(), data: metadata })
}

export async function runSyncTemplate(payload: Payload, input: SyncTemplateInput, ctx: SyncContext): Promise<SyncTemplateResult> {
  const now = ctx.now()
  const result: SyncTemplateResult = { status: 'synced', created: [], updated: [], trashed: [], contentChanged: [], revalidateTags: [] }
  const inputPath = input.path || null
  const official = input.fullName.toLowerCase() === OFFICIAL_REPO && !inputPath

  const { match: hint } = await resolveRepository(payload, { githubId: input.githubId, fullName: input.fullName })
  const meta = await ctx.github.getRepo({ githubId: input.githubId ?? hint?.githubId, fullName: input.fullName })
  if (!meta) {
    result.status = 'gone'
    if (hint) {
      const scope: Where = official
        ? { source: { equals: 'official' } }
        : inputPath ? { path: { equals: inputPath } } : { or: [{ path: { exists: false } }, { path: { equals: '' } }] }
      result.trashed = await trashTemplates(payload, { and: [{ repository: { equals: hint.id } }, scope] }, 'repository-gone', now)
    }
    result.revalidateTags = templateRevalidationTagsFor(result.trashed)
    return result
  }

  const resolved = await resolveRepository(payload, { githubId: meta.id, fullName: meta.full_name })
  const existing = resolved.match ?? (hint && (hint.githubId == null || hint.githubId === meta.id) ? hint : null)
  const stale = resolved.stale && resolved.stale.id !== existing?.id ? resolved.stale : null

  // Every remote read happens before the first write: a RateLimitError leaves the database untouched.
  const extracted = official ? await extractOfficialTemplates(meta, ctx.github) : [await extractCommunityTemplate(meta, ctx.github, inputPath)]
  const latest = await latestPayloadVersion(ctx, extracted)

  // One repository path is never both a plugin and a template.
  const heldByPlugins = existing ? await pluginPaths(payload, existing.id) : new Set<string>()
  const conflicting = extracted.filter((t) => heldByPlugins.has(pathKey(t.path)))
  for (const t of conflicting) {
    payload.logger.warn({ fullName: meta.full_name, path: t.path, slug: t.slug }, 'Template sync skipped: a plugin already lists this repository path')
  }
  if (!official && conflicting.length) {
    result.status = 'conflict'
    return result
  }
  const toWrite = extracted.filter((t) => !conflicting.includes(t))

  const repo = await upsertRepository(payload, meta, official, existing, stale, now)
  const bySlug = await templatesBySlug(payload, toWrite.map((t) => t.slug))
  const repoRef = { fullName: meta.full_name, defaultBranch: meta.default_branch ?? null }

  for (const raw of toWrite) {
    const t = clampExtractedTemplate(raw)
    const prev = bySlug.get(t.slug)
    const contentHash = templateContentHash(t)
    const readmeRender = await renderReadmeFor(payload, ctx, prev, { slug: t.slug, readme: t.readme, path: t.path }, repoRef)
    const data = {
      name: t.name,
      repository: repo.id,
      path: t.path,
      url: t.url,
      isOfficial: t.isOfficial,
      description: t.description,
      readme: t.readme ?? null,
      readmeTruncated: (raw.readme?.length ?? 0) > (t.readme?.length ?? 0),
      ...readmeRender,
      // Only when the README HTML was (re)rendered: otherwise the stored image still matches the stored HTML.
      ...('readmeHtml' in readmeRender ? { fallbackImageUrl: firstReadmeImage(readmeRender.readmeHtml) } : {}),
      contentHash,
      dependencyNames: t.dependencyNames,
      payloadVersionRange: t.payloadVersionRange,
      payloadMajors: payloadMajorsFromRange(t.payloadVersionRange, latest),
      stackDetected: t.stack,
      isTemplateRepo: meta.is_template === true,
      lastUpdatedAt: t.lastUpdatedAt,
      license: t.license,
    }
    if (!prev) {
      // Only creation sets visibility and source; admins and owners own the rest afterwards.
      const doc = await payload.create({
        collection: 'templates',
        overrideAccess: true,
        depth: 0,
        context: skipContext(),
        data: { ...data, slug: t.slug, source: official ? 'official' : input.source, visibility: 'listed', firstSeenAt: now.toISOString() },
      })
      result.created.push(t.slug)
      result.contentChanged.push(doc.id)
      await linkApprovedTemplateSubmissions(payload, { id: doc.id, repositoryFullName: meta.full_name, path: t.path })
      continue
    }
    // Only sync-trashed templates come back; an admin's trash decision stands.
    const restore = Boolean(prev.deletedAt) && Boolean(prev.syncTrashReason)
    await payload.update({
      collection: 'templates',
      id: prev.id,
      overrideAccess: true,
      trash: true,
      depth: 0,
      context: skipContext(),
      data: { ...data, ...(restore ? { deletedAt: null, syncTrashReason: null } : {}) },
    })
    result.updated.push(t.slug)
    const active = restore || !prev.deletedAt
    if (active && (prev.ai?.enrichedHash ?? null) !== contentHash) result.contentChanged.push(prev.id)
  }

  if (official) {
    // Folders gone from templates/ (kept: still listed, or skipped because a plugin holds the path).
    const kept = extracted.map((t) => t.slug)
    result.trashed = await trashTemplates(
      payload,
      { and: [{ repository: { equals: repo.id } }, { source: { equals: 'official' } }, { slug: { not_in: kept } }] },
      'package-removed',
      now,
    )
  }

  result.revalidateTags = templateRevalidationTagsFor([...result.created, ...result.updated, ...result.trashed])
  return result
}

/**
 * Inputs for one `sync-template` job each: the official monorepo first, then every non-trashed community or converted
 * template, then approved template submissions without a template. Deduplicated by lower-cased full name + path.
 */
export async function runDiscoverTemplates(payload: Payload): Promise<SyncTemplateInput[]> {
  const seen = new Set<string>()
  const out: SyncTemplateInput[] = []
  const add = (i: SyncTemplateInput) => {
    const key = `${i.fullName.toLowerCase()}\n${pathKey(i.path)}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(i)
  }

  const officialRow = (
    await payload.find({
      collection: 'repositories', overrideAccess: true, depth: 0, limit: 1, pagination: false,
      where: { fullName: { equals: OFFICIAL_REPO } }, select: { githubId: true },
    })
  ).docs[0]
  add({ fullName: OFFICIAL_REPO, githubId: officialRow?.githubId ?? null, path: null, source: 'official' })

  const community = await payload.find({
    collection: 'templates', overrideAccess: true, depth: 0, limit: 0, pagination: false, sort: 'id',
    where: { source: { in: ['submission', 'converted'] } },
    select: { repository: true, path: true, source: true },
  })
  const repoIds = [...new Set(community.docs.map((t) => relationId(t.repository)).filter((id): id is number => typeof id === 'number'))]
  const repos = repoIds.length
    ? (
        await payload.find({
          collection: 'repositories', overrideAccess: true, depth: 0, limit: 0, pagination: false,
          where: { id: { in: repoIds } }, select: { fullName: true, githubId: true },
        })
      ).docs
    : []
  const repoById = new Map(repos.map((r) => [r.id, r]))
  for (const t of community.docs) {
    const repo = repoById.get(relationId(t.repository) as number)
    if (!repo) continue
    add({ fullName: repo.fullName, githubId: repo.githubId ?? null, path: t.path || null, source: t.source === 'converted' ? 'converted' : 'submission' })
  }

  for (const i of await approvedTemplateSubmissionInputs(payload)) add(i)
  return out
}
