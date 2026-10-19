import type { PackageJson } from '@/types'
import { InvalidGitHubPathError, type GitHubClient, type GitHubRepo } from './github'
import { getPayloadVersion, getWorkspaceDirs, isLikelyPlugin, isMonorepo } from './packages'

export const OFFICIAL_REPO = 'payloadcms/payload'

export type ExtractedPlugin = {
  slug: string
  name: string
  packageName?: string
  path?: string
  url: string
  description: string
  payloadVersionRange: string | null
  readme?: string
  keywords: string[]
  isOfficial: boolean
}

export type Extraction = { plugins: ExtractedPlugin[]; isMonorepo: boolean }

type ReadPackage = { json: PackageJson }

const README_NAMES = ['README.md', 'readme.md', 'Readme.md']
const NO_DESCRIPTION = 'No description available'
const BATCH = 5
/** Caps on GitHub requests driven by an untrusted package.json. */
export const MAX_WORKSPACE_DIRS = 20
export const MAX_SUBDIRS_PER_DIR = 100

async function readPackageJson(gh: GitHubClient, fullName: string, ref: string, dir: string): Promise<ReadPackage | null> {
  const text = await gh.getRawFile(fullName, ref, dir ? `${dir}/package.json` : 'package.json')
  if (text === null) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { json: parsed as PackageJson } : null
  } catch {
    return null // unparseable package.json: treated as absent, like the legacy script
  }
}

/** Full README of a repository or package directory (legacy file-name order); undefined when there is none. */
export async function readReadme(gh: GitHubClient, fullName: string, ref: string, dir = ''): Promise<string | undefined> {
  for (const name of README_NAMES) {
    const text = await gh.getRawFile(fullName, ref, dir ? `${dir}/${name}` : name)
    if (text !== null) return text
  }
  return undefined
}

const ownedByPayload = (repo: GitHubRepo) => repo.owner.login.toLowerCase() === 'payloadcms'
const keywordsOf = (pkg: PackageJson | undefined): string[] =>
  Array.isArray(pkg?.keywords) ? pkg.keywords.filter((k): k is string => typeof k === 'string') : []

async function rootPlugin(repo: GitHubRepo, gh: GitHubClient, pkg: ReadPackage | null, payloadVersionRange: string | null): Promise<ExtractedPlugin> {
  return {
    slug: `${repo.id}-root`,
    name: repo.name.replace(/-/g, ' '),
    packageName: pkg?.json.name,
    url: repo.html_url,
    description: pkg?.json.description || repo.description || NO_DESCRIPTION,
    payloadVersionRange,
    readme: await readReadme(gh, repo.full_name, repo.default_branch),
    keywords: keywordsOf(pkg?.json),
    isOfficial: ownedByPayload(repo),
  }
}

async function scanDirs(repo: GitHubRepo, gh: GitHubClient, dirs: string[]): Promise<ExtractedPlugin[]> {
  const ref = repo.default_branch
  const found: ExtractedPlugin[] = []
  const seen = new Set<string>()
  for (const dir of dirs.slice(0, MAX_WORKSPACE_DIRS)) {
    // Workspace entries come from the repository's package.json and are untrusted: skip invalid ones.
    let listing
    try {
      listing = (await gh.listDirectory(repo.full_name, dir, ref)) ?? []
    } catch (error) {
      if (error instanceof InvalidGitHubPathError) continue
      throw error
    }
    const subdirs = listing.filter((e) => e.type === 'dir').slice(0, MAX_SUBDIRS_PER_DIR)
    for (let i = 0; i < subdirs.length; i += BATCH) {
      const batch = await Promise.all(
        subdirs.slice(i, i + BATCH).map(async (entry): Promise<ExtractedPlugin | null> => {
          const path = `${dir}/${entry.name}`
          let pkg: ReadPackage | null
          try {
            pkg = await readPackageJson(gh, repo.full_name, ref, path)
          } catch (error) {
            if (error instanceof InvalidGitHubPathError) return null
            throw error
          }
          if (!pkg || !isLikelyPlugin(entry.name, pkg.json)) return null
          return {
            slug: `${repo.id}-${entry.name}`,
            name: entry.name.replace(/-/g, ' '),
            packageName: pkg.json.name,
            path,
            url: `${repo.html_url}/tree/${ref}/${path}`,
            description: pkg.json.description || NO_DESCRIPTION,
            payloadVersionRange: getPayloadVersion(pkg.json),
            readme: await readReadme(gh, repo.full_name, ref, path),
            keywords: keywordsOf(pkg.json),
            isOfficial: ownedByPayload(repo),
          }
        }),
      )
      for (const plugin of batch) {
        if (plugin && !seen.has(plugin.slug)) {
          seen.add(plugin.slug)
          found.push(plugin)
        }
      }
    }
  }
  return found
}

/** Community repository -> plugins. Same decision order as the legacy `processRepository`. */
export async function extractPlugins(repo: GitHubRepo, gh: GitHubClient): Promise<Extraction> {
  const root = await readPackageJson(gh, repo.full_name, repo.default_branch, '')
  if (!root) return { plugins: [await rootPlugin(repo, gh, null, null)], isMonorepo: false }

  // 1. npm/yarn workspaces
  if (isMonorepo(root.json)) {
    const subs = await scanDirs(repo, gh, getWorkspaceDirs(root.json))
    if (subs.length) return { plugins: subs, isMonorepo: true }
  }
  // 2. private root without workspaces (pnpm-workspace.yaml)
  if (root.json.private) {
    const subs = await scanDirs(repo, gh, ['packages'])
    if (subs.length) return { plugins: subs, isMonorepo: true }
  }
  // 3. single package with a payload dependency
  const range = getPayloadVersion(root.json)
  if (range) return { plugins: [await rootPlugin(repo, gh, root, range)], isMonorepo: false }
  // 4. packages/ fallback
  const fallback = await scanDirs(repo, gh, ['packages'])
  if (fallback.length) return { plugins: fallback, isMonorepo: true }
  // 5. unknown single package
  return { plugins: [await rootPlugin(repo, gh, root, null)], isMonorepo: false }
}

/** payloadcms/payload -> one plugin per packages/plugin-* directory (legacy `fetchOfficialPayloadPlugins`). */
export async function extractOfficialPlugins(repo: GitHubRepo, gh: GitHubClient): Promise<Extraction> {
  const ref = repo.default_branch
  const dirs = ((await gh.listDirectory(repo.full_name, 'packages', ref)) ?? []).filter(
    (e) => e.type === 'dir' && e.name.startsWith('plugin-'),
  )
  if (dirs.length === 0) {
    throw new Error(`No packages/plugin-* directories found in ${repo.full_name}; refusing to treat every official plugin as removed.`)
  }
  const plugins: ExtractedPlugin[] = []
  for (let i = 0; i < dirs.length; i += BATCH) {
    const batch = await Promise.all(
      dirs.slice(i, i + BATCH).map(async (entry): Promise<ExtractedPlugin | null> => {
        const path = `packages/${entry.name}`
        const pkg = await readPackageJson(gh, repo.full_name, ref, path)
        if (!pkg) return null
        const displayName = entry.name.replace('plugin-', '').replace(/-/g, ' ')
        return {
          slug: `official-${entry.name}`,
          name: displayName,
          packageName: pkg.json.name || `@payloadcms/${entry.name}`,
          path,
          url: `${repo.html_url}/tree/${ref}/${path}`,
          description: pkg.json.description || `Official Payload CMS ${displayName} plugin`,
          payloadVersionRange: getPayloadVersion(pkg.json),
          readme: await readReadme(gh, repo.full_name, ref, path),
          keywords: keywordsOf(pkg.json),
          isOfficial: true,
        }
      }),
    )
    for (const plugin of batch) if (plugin) plugins.push(plugin)
  }
  if (plugins.length === 0) {
    throw new Error(`Extracted no official plugins from ${dirs.length} packages/plugin-* directories in ${repo.full_name}; refusing to treat every official plugin as removed.`)
  }
  return { plugins, isMonorepo: true }
}
