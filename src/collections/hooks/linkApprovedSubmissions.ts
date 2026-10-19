import type { CollectionAfterChangeHook } from 'payload'
import { relationId } from '@/lib/relationId'
import type { Plugin } from '@/payload-types'

/** When sync creates a plugin for a repository with approved, unlinked listing submissions, link them. */
export const linkApprovedSubmissions: CollectionAfterChangeHook<Plugin> = async ({ doc, operation, req }) => {
  if (operation !== 'create') return doc
  const repositoryId = relationId(doc.repository)
  if (repositoryId === undefined) return doc
  // System lookups and writes: submissions are admin-managed and the plugin was created by sync or an admin.
  const repo = await req.payload.findByID({
    collection: 'repositories', id: repositoryId, depth: 0, overrideAccess: true, req, disableErrors: true, select: { fullName: true },
  })
  if (!repo) return doc
  const open = await req.payload.find({
    collection: 'submissions',
    overrideAccess: true,
    req,
    depth: 0,
    limit: 50,
    where: {
      and: [
        { type: { equals: 'listing' } },
        { status: { equals: 'approved' } },
        { plugin: { exists: false } },
        // submissions.repositoryFullName is stored lower-case; compare exactly against the lower-cased name.
        { repositoryFullName: { equals: repo.fullName.toLowerCase() } },
      ],
    },
  })
  for (const submission of open.docs) {
    await req.payload.update({ collection: 'submissions', id: submission.id, data: { plugin: doc.id }, depth: 0, overrideAccess: true, req })
  }
  return doc
}
