import { readmePreview } from '@/lib/directory/readme'
import { authorDescriptionOf } from '@/lib/directory/tagline'
import type { Media, Repository, Template } from '@/payload-types'
import type { PayloadMajor } from '@/lib/versions'
import { embedUrlFor, canonicalVideoUrl, fallbackImageFor, getStartedFor, parseDemoUrl, parseVideoUrl } from './links'
import { effectiveStack } from './stack'
import type { TemplateDetail, TemplateImage, TemplateSummary } from './types'

/** `fallbackImageUrl` is admin-read only: it is not selected here, the query merges it in for listed templates. */
export const TEMPLATE_SUMMARY_SELECT = {
  slug: true, name: true, description: true, url: true, isOfficial: true, path: true, repository: true,
  payloadMajors: true, stackDetected: true, stackOverride: true, lastUpdatedAt: true,
  customTagline: true, ai: { tagline: true }, category: true, _h_tags: true, screenshots: true, demoUrl: true,
} as const

/** A template as the mappers read it; `fallbackImageUrl` is present only when the caller read it with overrideAccess. */
type TemplateDoc = Template

function repoOf(doc: TemplateDoc): Repository {
  if (typeof doc.repository !== 'object' || doc.repository === null) {
    throw new Error(`Template ${doc.slug} was loaded without depth >= 1`)
  }
  return doc.repository
}

function categoryOf(doc: TemplateDoc): { slug: string; title: string; path: string } | undefined {
  const c = doc.category
  if (!c || typeof c !== 'object') return undefined
  if (!c._h_slugPath) throw new Error(`Template ${doc.slug}: category "${c.slug}" was loaded without _h_slugPath`)
  return { slug: c.slug, title: c.title, path: c._h_slugPath }
}

const tagsOf = (doc: TemplateDoc) => (doc._h_tags ?? []).flatMap((t) => (t && typeof t === 'object' ? [{ slug: t.slug, title: t.title }] : []))

const populatedScreenshots = (doc: TemplateDoc): Media[] =>
  (doc.screenshots ?? []).flatMap((m) => (m && typeof m === 'object' && m.url ? [m] : []))

const cardUrl = (m: Media): string => m.variants?.card?.url || m.url || ''
const galleryUrl = (m: Media): string => m.variants?.gallery?.url || m.url || ''

function imageOf(doc: TemplateDoc, fullName: string): TemplateImage {
  const first = populatedScreenshots(doc)[0]
  if (first) {
    const card = cardUrl(first)
    const gallery = galleryUrl(first)
    const cardW = first.variants?.card?.width
    const galleryW = first.variants?.gallery?.width
    return {
      src: card,
      ...(card !== gallery && cardW && galleryW ? { srcSet: `${card} ${cardW}w, ${gallery} ${galleryW}w` } : {}),
      local: true,
    }
  }
  return { src: fallbackImageFor({ fallbackImageUrl: doc.fallbackImageUrl, fullName }), local: false }
}

export function templateTagline(doc: Pick<Template, 'customTagline' | 'ai' | 'description'>): string {
  return doc.customTagline?.trim() || doc.ai?.tagline?.trim() || authorDescriptionOf(doc.description)
}

export function toTemplateSummary(doc: TemplateDoc): TemplateSummary {
  const repo = repoOf(doc)
  const category = categoryOf(doc)
  const tags = tagsOf(doc)
  const majors = (doc.payloadMajors ?? []) as PayloadMajor[]
  const demoUrl = doc.demoUrl ? parseDemoUrl(doc.demoUrl) : null
  return {
    slug: doc.slug,
    name: doc.name,
    tagline: templateTagline(doc),
    owner: repo.owner,
    ownerAvatar: repo.ownerAvatar ?? '',
    repositoryUrl: repo.url,
    url: doc.url,
    isOfficial: Boolean(doc.isOfficial),
    stars: doc.isOfficial ? null : (repo.stars ?? 0),
    payloadMajors: majors.length ? majors : ['unknown'],
    stack: effectiveStack(doc),
    lastUpdate: doc.lastUpdatedAt ?? repo.pushedAt ?? '',
    createdAt: repo.githubCreatedAt ?? '',
    ...(category ? { categoryPath: category.path } : {}),
    ...(tags.length ? { tags: tags.map((t) => t.slug) } : {}),
    image: imageOf(doc, repo.fullName),
    ...(demoUrl ? { demoUrl } : {}),
  }
}

function aiOf(doc: TemplateDoc): TemplateDetail['ai'] {
  const summary = doc.ai?.summary?.trim() || undefined
  const features = doc.ai?.features ?? []
  const goodFor = doc.ai?.useCases ?? []
  if (!summary && features.length === 0 && goodFor.length === 0) return undefined
  return { summary, features, goodFor, generated: Boolean(summary) && !doc.locks?.summary }
}

export function toTemplateDetail(doc: TemplateDoc): TemplateDetail {
  const repo = repoOf(doc)
  const category = categoryOf(doc)
  const ai = aiOf(doc)
  const ref = doc.videoUrl ? parseVideoUrl(doc.videoUrl) : null
  return {
    ...toTemplateSummary(doc),
    authorDescription: authorDescriptionOf(doc.description),
    ...(doc.customTagline?.trim() ? { customTagline: doc.customTagline.trim() } : {}),
    license: doc.license ?? repo.license ?? null,
    path: doc.path || null,
    fullName: repo.fullName,
    screenshots: populatedScreenshots(doc).map((m) => {
      const width = m.variants?.gallery?.width ?? m.width
      const height = m.variants?.gallery?.height ?? m.height
      return { full: galleryUrl(m), card: cardUrl(m), alt: m.alt, ...(width ? { width } : {}), ...(height ? { height } : {}) }
    }),
    ...(ref ? { video: { provider: ref.provider, embedUrl: embedUrlFor(ref), watchUrl: canonicalVideoUrl(ref) } } : {}),
    getStarted: getStartedFor({
      isOfficial: Boolean(doc.isOfficial), slug: doc.slug, fullName: repo.fullName, path: doc.path || null, isTemplateRepo: Boolean(doc.isTemplateRepo),
    }),
    ...(ai ? { ai } : {}),
    ...(category ? { category } : {}),
    tagList: tagsOf(doc),
    readme: readmePreview(doc.readme),
    readmeFull: doc.readme ?? undefined,
    readmeTruncated: doc.readmeTruncated === true,
    payloadVersionRange: doc.payloadVersionRange ?? null,
  }
}
