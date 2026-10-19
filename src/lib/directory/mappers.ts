import { readmePreview } from './readme'
import { pluginTagline } from './tagline'
import type { Plugin, Repository } from '@/payload-types'
import type { PayloadMajor } from '@/lib/versions'
import type { PluginDetail, PluginSummary } from './types'

function repoOf(doc: Plugin): Repository {
  if (typeof doc.repository !== 'object' || doc.repository === null) {
    throw new Error(`Plugin ${doc.slug} was loaded without depth >= 1`)
  }
  return doc.repository
}

function categoryOf(doc: Plugin): { slug: string; title: string; path: string } | undefined {
  const c = doc.category
  if (!c || typeof c !== 'object') return undefined
  // Ruling F1: no silent slug fallback; the query must request _h_slugPath.
  if (!c._h_slugPath) throw new Error(`Plugin ${doc.slug}: category "${c.slug}" was loaded without _h_slugPath`)
  return { slug: c.slug, title: c.title, path: c._h_slugPath }
}

function tagsOf(doc: Plugin): { slug: string; title: string }[] {
  return (doc._h_tags ?? []).flatMap((t) => (t && typeof t === 'object' ? [{ slug: t.slug, title: t.title }] : []))
}

function aiOverviewOf(doc: Plugin): PluginDetail['ai'] {
  const summary = doc.ai?.summary?.trim() || undefined
  const features = doc.ai?.features ?? []
  const useCases = doc.ai?.useCases ?? []
  if (!summary && features.length === 0 && useCases.length === 0) return undefined
  const locks = doc.locks ?? {}
  // The "generated from the README" note is shown while any displayed part is still machine-written.
  const generated = (Boolean(summary) && !locks.summary) || (features.length > 0 && !locks.features) || (useCases.length > 0 && !locks.useCases)
  return { summary, features, useCases, generated }
}

export function toSummary(doc: Plugin): PluginSummary {
  const repo = repoOf(doc)
  const majors = (doc.payloadMajors ?? []) as PayloadMajor[]
  return {
    slug: doc.slug,
    name: doc.name,
    packageName: doc.packageName ?? undefined,
    description: pluginTagline(doc),
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
    ...(categoryOf(doc) ? { categoryPath: categoryOf(doc)!.path } : {}),
    ...(tagsOf(doc).length ? { tags: tagsOf(doc).map((t) => t.slug) } : {}),
  }
}

export function toDetail(doc: Plugin): PluginDetail {
  const ai = aiOverviewOf(doc)
  const category = categoryOf(doc)
  return {
    ...toSummary(doc),
    authorDescription: doc.description ?? '',
    readme: readmePreview(doc.readme),
    readmeFull: doc.readme ?? undefined,
    payloadVersionRange: doc.payloadVersionRange ?? null,
    npm: doc.npm ?? undefined,
    ...(ai ? { ai } : {}),
    ...(category ? { category } : {}),
    tagList: tagsOf(doc),
  }
}
