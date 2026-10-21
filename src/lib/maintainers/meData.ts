import type { Payload } from 'payload'
import type { CurrentMaintainer } from '@/lib/auth/current'

export const ME_LIST_LIMIT = 100

/** Everything `/me` shows, read as the maintainer, and restricted by explicit filters to their own rows. */
export async function loadMeData(payload: Payload, maintainer: CurrentMaintainer) {
  const [plugins, templates, submissions] = await Promise.all([
    payload.find({
      collection: 'plugins', overrideAccess: false, user: maintainer, depth: 1, limit: ME_LIST_LIMIT, sort: 'name',
      where: { maintainers: { in: [maintainer.id] } },
    }),
    // depth 1 populates `screenshots` (media: url and variants for the thumbnails).
    payload.find({
      collection: 'templates', overrideAccess: false, user: maintainer, depth: 1, limit: ME_LIST_LIMIT, sort: 'name',
      where: { maintainers: { in: [maintainer.id] } },
      select: { slug: true, name: true, customTagline: true, demoUrl: true, videoUrl: true, stackOverride: true, stackDetected: true, screenshots: true },
    }),
    payload.find({
      collection: 'submissions', overrideAccess: false, user: maintainer, depth: 1, limit: ME_LIST_LIMIT, sort: '-createdAt',
      where: { submittedBy: { equals: maintainer.id } },
    }),
  ])
  return {
    plugins: plugins.docs,
    templates: templates.docs,
    listings: submissions.docs.filter((s) => s.type === 'listing'),
    claims: submissions.docs.filter((s) => s.type === 'claim'),
    /** True when a list hit the cap, so older rows are not shown. */
    truncated: plugins.totalDocs > ME_LIST_LIMIT || templates.totalDocs > ME_LIST_LIMIT || submissions.totalDocs > ME_LIST_LIMIT,
  }
}
