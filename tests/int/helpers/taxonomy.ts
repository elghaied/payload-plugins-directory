import type { Payload } from 'payload'

const context = { skipRevalidate: true }

/** storage-media > {cloud-storage, media-management}, other; tags seo (seo, meta-tags) and s3 (aws-s3). */
export async function createTestTaxonomy(payload: Payload) {
  const category = (data: Record<string, unknown>) =>
    payload.create({ collection: 'categories', overrideAccess: true, depth: 0, context, data: data as never })
  const tag = (data: Record<string, unknown>) => payload.create({ collection: 'tags', overrideAccess: true, depth: 0, context, data: data as never })
  const storage = await category({ title: 'Storage & Media', slug: 'storage-media', intro: 'Where uploads live.' })
  const cloud = await category({ title: 'Cloud storage', slug: 'cloud-storage', intro: 'S3, R2 and friends.', parent: storage.id })
  const media = await category({ title: 'Media & images', slug: 'media-management', intro: 'Images and video.', parent: storage.id })
  const other = await category({ title: 'Other', slug: 'other', intro: 'Everything else.' })
  const seo = await tag({ title: 'SEO', slug: 'seo', aliases: ['seo', 'meta-tags'], createdBy: 'alias' })
  const s3 = await tag({ title: 'Amazon S3', slug: 's3', aliases: ['aws-s3'], createdBy: 'alias' })
  return { storage, cloud, media, other, seo, s3 }
}

export async function setAiSettings(
  payload: Payload,
  ai: Partial<{ enabled: boolean; model: string; instructions: string; maxNewTagsPerPlugin: number }>,
): Promise<void> {
  const current = (await payload.findGlobal({ slug: 'directory-settings', overrideAccess: true })).ai ?? {}
  await payload.updateGlobal({
    slug: 'directory-settings',
    overrideAccess: true,
    data: { ai: { enabled: true, model: 'claude-sonnet-5-5', instructions: '', maxNewTagsPerPlugin: 2, ...current, ...ai } },
  })
}

export const goodOutput = (over: Record<string, unknown> = {}) => ({
  category: 'cloud-storage',
  tags: ['s3', { new: 'Presigned uploads' }],
  tagline: 'Store Payload uploads in Amazon S3',
  summary: 'Adds an S3 storage adapter to Payload. Uploads go straight to your bucket.',
  features: ['S3 adapter for upload collections', 'Presigned client uploads', 'Per-collection prefixes'],
  useCases: ['Serve media from S3 instead of the local disk'],
  confidence: 0.9,
  ...over,
})
