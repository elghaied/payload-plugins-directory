import type { PayloadMajor } from '@/lib/versions'
import type { StackValue } from './stack'

/**
 * A card/gallery image. `panel` (an official template without a screenshot or usable README image) means: render the
 * local branded panel (name + stack), no image request at all; `src` is then empty.
 */
export type TemplateImage = { src: string; srcSet?: string; local: boolean; panel?: true }

export type TemplateSummary = {
  slug: string
  name: string
  /** Display tagline: customTagline, then ai.tagline, then the author description. */
  tagline: string
  owner: string
  ownerAvatar: string
  repositoryUrl: string
  url: string
  isOfficial: boolean
  /** null for official templates (they live in the shared payloadcms/payload repository). */
  stars: number | null
  payloadMajors: PayloadMajor[]
  stack: StackValue
  lastUpdate: string
  createdAt: string
  /** `_h_slugPath` of the template's category; absent = Uncategorized. */
  categoryPath?: string
  tags?: string[]
  /** Card image: the first screenshot (card size), else the README image, else the branded panel (official) or GitHub's social card. */
  image: TemplateImage
  demoUrl?: string
}

export type TemplateDetail = TemplateSummary & {
  authorDescription: string
  customTagline?: string
  license: string | null
  path: string | null
  fullName: string
  screenshots: { full: string; card: string; alt: string; width?: number; height?: number }[]
  video?: { provider: 'youtube' | 'vimeo' | 'loom'; embedUrl: string; watchUrl: string }
  getStarted: { kind: 'command' | 'link'; value: string }
  /** Plain strings only: render as text. */
  ai?: { summary?: string; features: string[]; goodFor: string[]; generated: boolean }
  category?: { slug: string; title: string; path: string }
  tagList: { slug: string; title: string }[]
  readme?: string
  readmeFull?: string
  /** Sanitized HTML; server-side only, set only while its stamp matches the README text. */
  readmeHtml?: string
  readmeRenderVersion?: string
  readmeTruncated?: boolean
  payloadVersionRange: string | null
}
