import type { Category, Plugin, Repository } from '@/payload-types'
import { clampChars } from '@/sync/limits'
import { authorDescriptionOf, pluginTagline } from '@/lib/directory/tagline'
import { UNTRUSTED_NOTICE } from './instructions'

export const README_MCP_LIMIT = 20_000

export type McpTaxon = { slug: string; title: string }
export type McpCategoryRef = McpTaxon & { path: string | null }
export type McpPluginSummary = {
  slug: string
  name: string
  tagline: string
  packageName: string | null
  directoryUrl: string
  repositoryUrl: string | null
  npmUrl: string | null
  payloadMajors: string[]
  category: McpCategoryRef | null
  tags: McpTaxon[]
  stars: number | null
  weeklyDownloads: number | null
  healthScore: number | null
  isOfficial: boolean
  isArchived: boolean
  lastPushedAt: string | null
}
export type McpPluginDetail = McpPluginSummary & {
  authorDescription: string | null
  ai: { tagline: string | null; summary: string | null; features: string[]; useCases: string[]; confidence: number | null } | null
  payloadVersionRange: string | null
  npm: {
    latestVersion: string | null
    weeklyDownloads: number | null
    monthlyDownloads: number | null
    lastPublish: string | null
    unpackedSize: number | null
    dependencyCount: number | null
  } | null
  license: string | null
  forks: number | null
  openIssues: number | null
  readme: string | null
  readmeTruncated: boolean
  untrustedFields: string[]
  notice: string
}
export type McpComparisonRow = McpPluginSummary &
  Pick<McpPluginDetail, 'payloadVersionRange' | 'license' | 'forks' | 'openIssues'> & {
    latestVersion: string | null
    lastPublish: string | null
    monthlyDownloads: number | null
  }
export type McpCategory = { slug: string; title: string; path: string; parentSlug: string | null; intro: string | null; pluginCount: number }

const obj = <T>(v: unknown): T | null => (typeof v === 'object' && v !== null ? (v as T) : null)
const taxon = (v: unknown): McpTaxon | null => {
  const t = obj<{ slug?: unknown; title?: unknown }>(v)
  return t && typeof t.slug === 'string' ? { slug: t.slug, title: typeof t.title === 'string' ? t.title : t.slug } : null
}
const categoryRef = (v: unknown): McpCategoryRef | null => {
  const base = taxon(v)
  // `_h_slugPath` exists only when the read asked for it; there is no slug fallback for a missing path.
  const path = obj<{ _h_slugPath?: unknown }>(v)?._h_slugPath
  return base ? { ...base, path: typeof path === 'string' && path ? path : null } : null
}

// Explicit allowlists: a field reaches an agent only if it is named here.
export function toMcpPluginSummary(doc: Plugin, siteURL: string): McpPluginSummary {
  const repo = obj<Repository>(doc.repository)
  return {
    slug: doc.slug,
    name: doc.name,
    // The sync placeholder is not the author's words; it never becomes a tagline.
    tagline: pluginTagline({ customTagline: doc.customTagline, ai: doc.ai, description: authorDescriptionOf(doc.description) }),
    packageName: doc.packageName ?? null,
    directoryUrl: `${siteURL}/plugins/${doc.slug}`,
    repositoryUrl: repo?.url ?? null,
    npmUrl: doc.packageName ? `https://www.npmjs.com/package/${doc.packageName}` : null,
    payloadMajors: doc.payloadMajors?.length ? [...doc.payloadMajors] : ['unknown'],
    category: categoryRef(doc.category),
    tags: (doc._h_tags ?? []).map(taxon).filter((t): t is McpTaxon => t !== null),
    stars: repo?.stars ?? null,
    weeklyDownloads: doc.npm?.weeklyDownloads ?? null,
    healthScore: doc.healthScore ?? null,
    isOfficial: Boolean(doc.isOfficial),
    isArchived: Boolean(repo?.isArchived),
    lastPushedAt: repo?.pushedAt ?? null,
  }
}

export function toMcpPluginDetail(doc: Plugin, siteURL: string): McpPluginDetail {
  const repo = obj<Repository>(doc.repository)
  const a = doc.ai
  const hasAi = Boolean(a && (a.tagline || a.summary || a.features?.length || a.useCases?.length))
  const readme = doc.readme ?? null
  return {
    ...toMcpPluginSummary(doc, siteURL),
    authorDescription: authorDescriptionOf(doc.description) || null,
    ai: hasAi
      ? {
          tagline: a?.tagline ?? null,
          summary: a?.summary ?? null,
          features: [...(a?.features ?? [])],
          useCases: [...(a?.useCases ?? [])],
          confidence: a?.confidence ?? null,
        }
      : null,
    payloadVersionRange: doc.payloadVersionRange ?? null,
    npm: doc.npm
      ? {
          latestVersion: doc.npm.latestVersion ?? null,
          weeklyDownloads: doc.npm.weeklyDownloads ?? null,
          monthlyDownloads: doc.npm.monthlyDownloads ?? null,
          lastPublish: doc.npm.lastPublish ?? null,
          unpackedSize: doc.npm.unpackedSize ?? null,
          dependencyCount: doc.npm.dependencyCount ?? null,
        }
      : null,
    license: repo?.license ?? null,
    forks: repo?.forks ?? null,
    openIssues: repo?.openIssues ?? null,
    readme: readme ? clampChars(readme, README_MCP_LIMIT) : null,
    readmeTruncated: Boolean(readme && readme.length > README_MCP_LIMIT),
    untrustedFields: ['tagline', 'authorDescription', 'readme', 'ai'],
    notice: UNTRUSTED_NOTICE,
  }
}

export function toMcpComparisonRow(doc: Plugin, siteURL: string): McpComparisonRow {
  const repo = obj<Repository>(doc.repository)
  return {
    ...toMcpPluginSummary(doc, siteURL),
    payloadVersionRange: doc.payloadVersionRange ?? null,
    license: repo?.license ?? null,
    forks: repo?.forks ?? null,
    openIssues: repo?.openIssues ?? null,
    latestVersion: doc.npm?.latestVersion ?? null,
    lastPublish: doc.npm?.lastPublish ?? null,
    monthlyDownloads: doc.npm?.monthlyDownloads ?? null,
  }
}

/** The category must have been read with `_h_slugPath` (context `computeHierarchyPaths`); there is no slug fallback. */
export function toMcpCategory(doc: Pick<Category, 'slug' | 'title' | 'intro' | '_h_slugPath'>, parentSlug: string | null, pluginCount: number): McpCategory {
  if (!doc._h_slugPath) throw new Error(`Category "${doc.slug}" was loaded without _h_slugPath`)
  return { slug: doc.slug, title: doc.title, path: doc._h_slugPath, parentSlug, intro: doc.intro ?? null, pluginCount }
}
