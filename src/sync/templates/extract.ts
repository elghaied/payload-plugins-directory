import { isValidSlug } from '@/lib/cacheTags'
import { NO_DESCRIPTION } from '@/lib/directory/tagline'
import { detectStack, type StackValue } from '@/lib/templates/stack'
import type { PackageJson } from '@/types'
import { readPackageJson, readReadme, type ReadPackage } from '../extract'
import type { GitHubClient, GitHubRepo } from '../github'
import { getPayloadVersion } from '../packages'

export type ExtractedTemplate = {
  slug: string
  name: string
  path: string | null
  url: string
  description: string
  readme?: string
  payloadVersionRange: string | null
  stack: StackValue
  dependencyNames: string[]
  license: string | null
  lastUpdatedAt: string | null
  isOfficial: boolean
}

export const OFFICIAL_TEMPLATE_SLUG = /^[a-z][a-z0-9-]{0,60}$/
export const RESERVED_TEMPLATE_SLUGS = new Set(['categories'])

const OFFICIAL_TEMPLATES_DIR = 'templates'
const BATCH = 5
const MAX_DEPENDENCY_NAMES = 100
const MAX_DEPENDENCY_NAME_LENGTH = 214
const MAX_LICENSE_LENGTH = 64
const GENERIC_NAMES = new Set(['template', 'payload-template'])
const NPM_NAME = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/

const isEligibleOfficial = (name: string) =>
  !name.startsWith('_') && name !== 'plugin' && OFFICIAL_TEMPLATE_SLUG.test(name) && !RESERVED_TEMPLATE_SLUGS.has(name)

const titleCase = (folder: string) =>
  folder
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

function dependencyNamesOf(pkg: PackageJson | null): string[] {
  const names = new Set<string>()
  for (const deps of [pkg?.dependencies, pkg?.devDependencies]) {
    if (!deps || typeof deps !== 'object') continue
    for (const key of Object.keys(deps)) if (key.length <= MAX_DEPENDENCY_NAME_LENGTH) names.add(key)
  }
  return [...names].sort().slice(0, MAX_DEPENDENCY_NAMES)
}

const stringField = (pkg: PackageJson | null, key: 'name' | 'description' | 'license'): string | null => {
  const value = (pkg as Record<string, unknown> | null)?.[key]
  return typeof value === 'string' && value.trim() ? value : null
}

/** payloadcms/payload -> one template per eligible `templates/<folder>` directory that has a package.json. */
export async function extractOfficialTemplates(repo: GitHubRepo, gh: GitHubClient): Promise<ExtractedTemplate[]> {
  const ref = repo.default_branch
  const dirs = ((await gh.listDirectory(repo.full_name, OFFICIAL_TEMPLATES_DIR, ref)) ?? []).filter(
    (e) => e.type === 'dir' && isEligibleOfficial(e.name),
  )
  if (dirs.length === 0) {
    throw new Error(`No eligible templates/* directories found in ${repo.full_name}; refusing to treat every official template as removed.`)
  }
  const templates: ExtractedTemplate[] = []
  for (let i = 0; i < dirs.length; i += BATCH) {
    const batch = await Promise.all(
      dirs.slice(i, i + BATCH).map(async (entry): Promise<ExtractedTemplate | null> => {
        const path = `${OFFICIAL_TEMPLATES_DIR}/${entry.name}`
        const pkg = await readPackageJson(gh, repo.full_name, ref, path)
        if (!pkg) return null
        const name = titleCase(entry.name)
        const [readme, lastUpdatedAt] = await Promise.all([
          readReadme(gh, repo.full_name, ref, path),
          gh.lastCommitDate(repo.full_name, path, ref),
        ])
        return {
          slug: entry.name,
          name,
          path,
          url: `${repo.html_url}/tree/${ref}/${path}`,
          description: stringField(pkg.json, 'description') ?? `Official Payload CMS ${name} template`,
          readme,
          payloadVersionRange: getPayloadVersion(pkg.json),
          stack: detectStack(pkg.json),
          dependencyNames: dependencyNamesOf(pkg.json),
          license: licenseOf(pkg.json, repo),
          lastUpdatedAt,
          isOfficial: true,
        }
      }),
    )
    for (const template of batch) if (template) templates.push(template)
  }
  if (templates.length === 0) {
    throw new Error(`Extracted no official templates from ${dirs.length} templates/* directories in ${repo.full_name}; refusing to treat every official template as removed.`)
  }
  return templates
}

function licenseOf(pkg: PackageJson | null, repo: GitHubRepo): string | null {
  const own = stringField(pkg, 'license')
  if (own && own.length <= MAX_LICENSE_LENGTH) return own
  return repo.license?.spdx_id ?? null
}

/** A community repository root (`path` null) or subfolder -> exactly one template. */
export async function extractCommunityTemplate(repo: GitHubRepo, gh: GitHubClient, path: string | null): Promise<ExtractedTemplate> {
  const ref = repo.default_branch
  const pkg: ReadPackage | null = await readPackageJson(gh, repo.full_name, ref, path ?? '')
  const json = pkg?.json ?? null
  const last = path ? path.split('/').pop()! : null
  let slug = last ? `${repo.id}-${last}` : `${repo.id}-root`
  if (!isValidSlug(slug)) slug = `${repo.id}-${(last ?? 'root').replace(/[^A-Za-z0-9._-]/g, '-')}`.slice(0, 200)
  const pkgName = stringField(json, 'name')
  const name =
    pkgName && pkgName.length <= MAX_DEPENDENCY_NAME_LENGTH && NPM_NAME.test(pkgName) && !GENERIC_NAMES.has(pkgName)
      ? pkgName
      : repo.name.replace(/-/g, ' ')
  return {
    slug,
    name,
    path,
    url: path ? `${repo.html_url}/tree/${ref}/${path}` : repo.html_url,
    description: stringField(json, 'description') ?? repo.description ?? NO_DESCRIPTION,
    readme: await readReadme(gh, repo.full_name, ref, path ?? ''),
    payloadVersionRange: json ? getPayloadVersion(json) : null,
    stack: detectStack(json),
    dependencyNames: dependencyNamesOf(json),
    license: licenseOf(json, repo),
    lastUpdatedAt: repo.pushed_at,
    // Official means synced from templates/ of payloadcms/payload (Ruling 12), never "owned by the payloadcms org".
    isOfficial: false,
  }
}
