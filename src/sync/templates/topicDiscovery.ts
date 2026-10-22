import { eq } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import { jobStatus } from '@/db/jobStatus'
import { parseSubmissionUrl, parseTemplateSubmissionUrl } from '@/lib/submissions/url'
import type { PackageJson } from '@/types'
import { readPackageJson } from '../extract'
import { InvalidGitHubPathError, type GitHubClient, type GitHubRepo } from '../github'
import { getWorkspaceDirs } from '../packages'
import type { SyncTemplateInput } from './syncTemplate'

/**
 * Template discovery (the hybrid): repositories with the `payload-template` topic are listed automatically, like
 * `payload-plugin` for plugins (the author opted in). Broader searches only SUGGEST: they become pending submissions
 * (origin "discovery") an admin approves or rejects. A rejected suggestion is never suggested again.
 */
export const AUTO_LIST_QUERY = 'topic:payload-template'

/** Searches whose results are only suggested. Bare `topic:payload` is used only with `template:true` (it is noisy). */
export const SUGGEST_QUERIES = [
  'topic:payload-theme',
  'topic:payloadcms topic:template',
  'topic:payloadcms topic:starter',
  'topic:payloadcms topic:boilerplate',
  'topic:payloadcms topic:starter-kit',
  'topic:payloadcms topic:starter-template',
  'topic:payload-cms topic:template',
  'topic:payload-cms topic:starter',
  'topic:payload-cms topic:boilerplate',
  'topic:payload topic:template',
  'topic:payload topic:starter',
  'topic:payloadcms template:true',
  'topic:payload-cms template:true',
  'topic:payload template:true',
] as const

/** Results read per search: well above today's counts (≤ 40 per query) without paging through noise. */
const RESULTS_PER_QUERY = 200
export const MAX_SUGGESTIONS_PER_RUN = 50
/** A repository found not to use Payload is checked again after this long. */
const RECHECK_AFTER_MS = 30 * 86_400_000
/** Suggestions need some sign of life: a star, or a push within this long. */
const SUGGEST_MAX_IDLE_MS = 2 * 365 * 86_400_000
/** job_status row remembering repositories that failed the Payload check: `details` = { [fullName]: checkedAt }. */
export const NOT_PAYLOAD_KEY = 'template-discovery:not-payload'

/** Folders that commonly hold the Payload app of a monorepo or an Astro/Nuxt + Payload starter. */
const APP_DIRS = ['payload', 'cms', 'backend', 'server', 'admin', 'api', 'web', 'app']
const PARENT_DIRS = ['apps', 'packages']
const MAX_PACKAGE_READS = 24
const MAX_SUBDIRS = 10

export function hasPayloadDependency(pkg: PackageJson | null | undefined): boolean {
  if (!pkg) return false
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies }
  return Object.keys(deps).some((name) => name === 'payload' || name.startsWith('@payloadcms/'))
}

/**
 * Whether the repository is a Payload project: `payload` or an `@payloadcms/*` package in the root package.json, in
 * a common app folder (`payload/`, `cms/`…), or in a package under a workspace or `apps/`/`packages/` folder (two
 * levels at most). Raw file reads cost no API quota; folder listings (at most a few per repository) do.
 */
export async function dependsOnPayload(gh: GitHubClient, repo: GitHubRepo): Promise<boolean> {
  const full = repo.full_name
  const ref = repo.default_branch
  let reads = 0
  const read = async (dir: string) => {
    if (reads >= MAX_PACKAGE_READS) return null
    reads++
    try {
      return (await readPackageJson(gh, full, ref, dir))?.json ?? null
    } catch (error) {
      if (error instanceof InvalidGitHubPathError) return null
      throw error
    }
  }
  const root = await read('')
  if (hasPayloadDependency(root)) return true
  for (const dir of APP_DIRS) if (hasPayloadDependency(await read(dir))) return true
  const parents = [...new Set([...(root ? getWorkspaceDirs(root) : []), ...PARENT_DIRS])].slice(0, 4)
  for (const parent of parents) {
    let listing
    try {
      listing = await gh.listDirectory(full, parent, ref)
    } catch (error) {
      if (error instanceof InvalidGitHubPathError) continue
      throw error
    }
    for (const entry of (listing ?? []).filter((e) => e.type === 'dir').slice(0, MAX_SUBDIRS)) {
      if (hasPayloadDependency(await read(`${parent}/${entry.name}`))) return true
      if (reads >= MAX_PACKAGE_READS) return false
    }
  }
  return false
}

type Candidate = { repo: GitHubRepo; mode: 'auto' | 'suggest'; via: Set<string> }

export type TopicDiscoveryResult = {
  /** sync-template inputs for new `payload-template` repositories (source `topic`). */
  autoListed: SyncTemplateInput[]
  suggested: number
  /** Repositories found by the searches before any filtering. */
  found: number
  /** Failed the Payload check this run (remembered for 30 days). */
  notPayload: number
}

const lower = (s: string) => s.toLowerCase()

/** Repositories that already have a submission (any status, any kind), by lower-cased full name. */
async function submittedRepos(payload: Payload): Promise<Set<string>> {
  const res = await payload.find({
    collection: 'submissions',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    where: { type: { equals: 'listing' } },
    select: { url: true, repositoryFullName: true },
  })
  const out = new Set<string>()
  for (const s of res.docs) {
    if (s.repositoryFullName) out.add(lower(s.repositoryFullName))
    const target = s.url ? parseSubmissionUrl(s.url) : null
    if (target?.kind === 'github') out.add(lower(target.fullName))
  }
  return out
}

/** Repositories already listed as a plugin or a template (trashed included: an admin's removal stands). */
async function listedRepoIds(payload: Payload, githubIds: number[]): Promise<Set<number>> {
  if (githubIds.length === 0) return new Set()
  const repos = await payload.find({
    collection: 'repositories', overrideAccess: true, depth: 0, limit: 0, pagination: false,
    where: { githubId: { in: githubIds } }, select: { githubId: true },
  })
  const byId = new Map(repos.docs.map((r) => [r.id, r.githubId as number]))
  if (byId.size === 0) return new Set()
  const ids = [...byId.keys()]
  const listed = new Set<number>()
  for (const collection of ['plugins', 'templates'] as const) {
    const res = await payload.find({
      collection, overrideAccess: true, depth: 0, limit: 0, pagination: false, trash: true,
      where: { repository: { in: ids } }, select: { repository: true },
    })
    for (const d of res.docs) {
      const gid = byId.get(typeof d.repository === 'object' && d.repository ? d.repository.id : (d.repository as number))
      if (gid) listed.add(gid)
    }
  }
  return listed
}

async function readNotPayload(payload: Payload): Promise<Record<string, string>> {
  const row = (await payload.db.drizzle.select().from(jobStatus).where(eq(jobStatus.key, NOT_PAYLOAD_KEY)))[0]
  return (row?.details as Record<string, string> | null) ?? {}
}

async function writeNotPayload(payload: Payload, map: Record<string, string>, now: Date): Promise<void> {
  await payload.db.drizzle
    .insert(jobStatus)
    .values({ key: NOT_PAYLOAD_KEY, lastSuccessAt: now, details: map, updatedAt: now })
    .onConflictDoUpdate({ target: jobStatus.key, set: { lastSuccessAt: now, details: map, updatedAt: now } })
}

function suggestionNote(c: Candidate): string {
  const topics = (c.repo.topics ?? []).filter((t) => /payload|template|starter|boilerplate|theme/.test(t)).slice(0, 6)
  const parts = [
    `Found by template discovery (${[...c.via].join(', ')}).`,
    `${c.repo.stargazers_count} stars · updated ${c.repo.pushed_at.slice(0, 10)}${c.repo.is_template ? ' · GitHub template repository' : ''}.`,
    topics.length ? `Topics: ${topics.join(', ')}.` : '',
    c.repo.description ? `“${c.repo.description.slice(0, 300)}”` : '',
  ]
  return parts.filter(Boolean).join('\n').slice(0, 1000)
}

export async function runTemplateTopicDiscovery(payload: Payload, gh: GitHubClient, now: Date): Promise<TopicDiscoveryResult> {
  const candidates = new Map<string, Candidate>()
  const add = (repo: GitHubRepo, mode: Candidate['mode'], query: string) => {
    const key = lower(repo.full_name)
    const c = candidates.get(key)
    if (c) {
      if (mode === 'auto') c.mode = 'auto'
      c.via.add(query)
    } else candidates.set(key, { repo, mode, via: new Set([query]) })
  }
  for (const repo of (await gh.searchRepos(AUTO_LIST_QUERY, RESULTS_PER_QUERY)).repos) add(repo, 'auto', AUTO_LIST_QUERY)
  for (const query of SUGGEST_QUERIES) {
    for (const repo of (await gh.searchRepos(query, RESULTS_PER_QUERY)).repos) add(repo, 'suggest', query)
  }
  const found = candidates.size

  const pool = [...candidates.values()].filter(({ repo }) => !repo.archived && lower(repo.owner.login) !== 'payloadcms')
  const [listed, submitted, notPayloadMap] = await Promise.all([
    listedRepoIds(payload, pool.map((c) => c.repo.id)),
    submittedRepos(payload),
    readNotPayload(payload),
  ])
  // Forget old "not Payload" verdicts so a repository that adopts Payload is found again.
  for (const [name, at] of Object.entries(notPayloadMap)) if (now.getTime() - Date.parse(at) > RECHECK_AFTER_MS) delete notPayloadMap[name]

  const fresh = pool.filter(({ repo, mode }) => {
    const key = lower(repo.full_name)
    if (listed.has(repo.id) || submitted.has(key) || notPayloadMap[key]) return false
    if (mode === 'suggest' && repo.stargazers_count < 1 && now.getTime() - Date.parse(repo.pushed_at) > SUGGEST_MAX_IDLE_MS) return false
    return true
  })
  // Listed first, then the most starred suggestions (the per-run cap keeps the review queue manageable).
  fresh.sort((a, b) => (a.mode === b.mode ? b.repo.stargazers_count - a.repo.stargazers_count : a.mode === 'auto' ? -1 : 1))

  const autoListed: SyncTemplateInput[] = []
  let suggested = 0
  let notPayload = 0
  for (const c of fresh) {
    if (c.mode === 'suggest' && suggested >= MAX_SUGGESTIONS_PER_RUN) break
    if (!(await dependsOnPayload(gh, c.repo))) {
      notPayloadMap[lower(c.repo.full_name)] = now.toISOString()
      notPayload++
      continue
    }
    if (c.mode === 'auto') {
      autoListed.push({ fullName: c.repo.full_name, githubId: c.repo.id, path: null, source: 'topic' })
      continue
    }
    const target = parseTemplateSubmissionUrl(c.repo.html_url)
    if (!target) continue
    await payload.create({
      collection: 'submissions',
      overrideAccess: true,
      depth: 0,
      data: {
        type: 'listing',
        kind: 'template',
        url: target.canonicalUrl,
        repositoryFullName: lower(target.fullName),
        status: 'pending',
        origin: 'discovery',
        note: suggestionNote(c),
      },
    })
    suggested++
  }
  await writeNotPayload(payload, notPayloadMap, now)
  return { autoListed, suggested, found, notPayload }
}
