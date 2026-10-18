import type { Plugin, Repository } from '@/payload-types'
import type { PayloadMajor } from '@/lib/versions'
import type { PluginDetail, PluginSummary } from './types'

function repoOf(doc: Plugin): Repository {
  if (typeof doc.repository !== 'object' || doc.repository === null) {
    throw new Error(`Plugin ${doc.slug} was loaded without depth >= 1`)
  }
  return doc.repository
}

export function toSummary(doc: Plugin): PluginSummary {
  const repo = repoOf(doc)
  const majors = (doc.payloadMajors ?? []) as PayloadMajor[]
  return {
    slug: doc.slug,
    name: doc.name,
    packageName: doc.packageName ?? undefined,
    description: doc.description ?? '',
    owner: repo.owner,
    ownerAvatar: repo.ownerAvatar ?? '',
    url: doc.url,
    repositoryUrl: repo.url,
    collection: repo.isMonorepo ? repo.fullName.split('/')[1] : undefined,
    stars: repo.stars ?? 0,
    forks: repo.forks ?? 0,
    openIssues: repo.openIssues ?? 0,
    lastUpdate: repo.pushedAt ?? '',
    createdAt: repo.githubCreatedAt ?? '',
    topics: repo.topics ?? [],
    isOfficial: Boolean(doc.isOfficial),
    payloadMajors: majors.length ? majors : ['unknown'],
    license: repo.license ?? null,
    isArchived: Boolean(repo.isArchived),
    weeklyDownloads: doc.npm?.weeklyDownloads ?? undefined,
    latestVersion: doc.npm?.latestVersion ?? undefined,
    unpackedSize: doc.npm?.unpackedSize ?? undefined,
    healthScore: doc.healthScore ?? undefined,
  }
}

export function toDetail(doc: Plugin): PluginDetail {
  return {
    ...toSummary(doc),
    readme: doc.readme ?? undefined,
    payloadVersionRange: doc.payloadVersionRange ?? null,
    npm: doc.npm ?? undefined,
  }
}
