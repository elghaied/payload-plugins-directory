import type { Plugin } from '@/payload-types'
import type { ListedPluginRef } from './types'

export function toListedRef(doc: Plugin): ListedPluginRef {
  const repo = doc.repository
  if (typeof repo !== 'object' || repo === null) {
    throw new Error(`Plugin ${doc.slug} was loaded without depth >= 1`)
  }
  return {
    id: doc.id,
    slug: doc.slug,
    name: doc.name,
    isOfficial: Boolean(doc.isOfficial),
    firstSeenAt: doc.firstSeenAt ?? null,
    repository: {
      id: repo.id,
      fullName: repo.fullName,
      owner: repo.owner,
      ownerAvatar: repo.ownerAvatar ?? '',
      pushedAt: repo.pushedAt ?? null,
      githubCreatedAt: repo.githubCreatedAt ?? null,
    },
  }
}
