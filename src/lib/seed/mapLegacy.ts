import type { NpmData } from '@/types'
import { payloadMajorsFromRange, type PayloadMajor } from '@/lib/versions'

export interface LegacyPlugin {
  id: string;
  name: string;
  packageName?: string;
  collection?: string;
  description: string;
  stars: number;
  forks: number;
  lastUpdate: string;
  createdAt: string;
  owner: string;
  ownerAvatar: string;
  url: string;
  topics: string[];
  isOfficial: boolean;
  payloadVersion: string | null;
  payloadVersionMajor: number[];
  license: string | null;
  openIssues: number;
  isArchived: boolean;
  readme?: string;
  npm?: NpmData;
  healthScore?: number;
}

export interface LegacyPluginsData {
  lastUpdated: string;
  totalCount: number;
  plugins: LegacyPlugin[];
}

export type RepositoryInput = {
  fullName: string
  githubId?: number
  owner: string
  ownerAvatar: string
  url: string
  stars: number
  forks: number
  openIssues: number
  license: string | null
  isArchived: boolean
  pushedAt: string
  githubCreatedAt: string
  topics: string[]
  isMonorepo: boolean
}

export type PluginInput = {
  slug: string
  name: string
  packageName?: string
  repositoryFullName: string
  path?: string
  url: string
  isOfficial: boolean
  source: 'topic' | 'official'
  description: string
  readme?: string
  payloadVersionRange: string | null
  payloadMajors: PayloadMajor[]
  npm?: Omit<NpmData, 'unpackedSize'> & { unpackedSize: number | null }
  healthScore?: number
  visibility: 'listed' | 'hidden'
}

export function repoFullNameFromUrl(url: string): string {
  const [, owner, repo] = new URL(url).pathname.split('/')
  return `${owner}/${repo}`
}

function monorepoPath(url: string): string | undefined {
  const match = new URL(url).pathname.match(/\/tree\/[^/]+\/(.+)$/)
  return match?.[1]
}

export function mapLegacy(
  data: LegacyPluginsData,
  blocklist: string[],
): { repositories: RepositoryInput[]; plugins: PluginInput[] } {
  const hidden = new Set(blocklist)
  const repos = new Map<string, RepositoryInput & { pluginCount: number }>()

  for (const p of data.plugins) {
    const fullName = repoFullNameFromUrl(p.url)
    const existing = repos.get(fullName)
    if (existing) {
      existing.pluginCount++
      continue
    }
    const idPrefix = p.id.match(/^(\d+)-/)?.[1]
    repos.set(fullName, {
      fullName,
      githubId: idPrefix ? Number(idPrefix) : undefined,
      owner: p.owner,
      ownerAvatar: p.ownerAvatar,
      url: `https://github.com/${fullName}`,
      stars: p.stars,
      forks: p.forks,
      openIssues: p.openIssues,
      license: p.license,
      isArchived: p.isArchived,
      pushedAt: p.lastUpdate,
      githubCreatedAt: p.createdAt,
      topics: p.topics,
      isMonorepo: false,
      pluginCount: 1,
    })
  }

  const repositories = [...repos.values()].map(({ pluginCount, ...repo }) => ({
    ...repo,
    isMonorepo: pluginCount > 1 || repo.fullName === 'payloadcms/payload',
  }))

  const plugins = data.plugins.map<PluginInput>((p) => ({
    slug: p.id,
    name: p.name,
    packageName: p.packageName,
    repositoryFullName: repoFullNameFromUrl(p.url),
    path: monorepoPath(p.url),
    url: p.url,
    isOfficial: p.isOfficial,
    source: p.isOfficial ? 'official' : 'topic',
    description: p.description,
    readme: p.readme || undefined,
    payloadVersionRange: p.payloadVersion,
    payloadMajors: payloadMajorsFromRange(p.payloadVersion, p.npm?.latestVersion ?? null),
    npm: p.npm,
    healthScore: p.healthScore,
    visibility: hidden.has(p.id) ? 'hidden' : 'listed',
  }))

  return { repositories, plugins }
}
