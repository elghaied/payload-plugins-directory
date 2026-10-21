import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import { createNpmRepositoryResolver, type NpmRepositoryResolver } from '@/lib/npm/repository'
import { relationId } from '@/lib/relationId'
import type { Submission } from '@/payload-types'
import { findPluginForRepository, findTemplateForRepositoryPath } from './duplicates'
import { enqueueRepositorySync, enqueueTemplateSync } from './enqueueSync'
import { MESSAGES } from './messages'
import { parseSubmissionUrl, parseTemplateSubmissionUrl } from './url'

export function becomesApproved(operation: string, status: unknown, previousStatus: unknown): boolean {
  return status === 'approved' && (operation === 'create' || previousStatus !== 'approved')
}

/**
 * Fills `repositoryFullName` when a listing becomes approved; blocks approval if it cannot be resolved.
 * An npm-metadata match only decides WHICH repository to sync. It proves nothing about who owns it, so approving a
 * listing never grants maintainer rights (only approving a claim does).
 */
export const resolveApprovedListing: CollectionBeforeChangeHook = async ({ data, operation, originalDoc, req }) => {
  const type = data.type ?? originalDoc?.type
  const invalid = (path: string, message: string) => new ValidationError({ collection: 'submissions', errors: [{ path, message }], req })

  // An approved submission is final: its side effects (a maintainer grant, a queued sync) are not undone by a status
  // change, so the record must not claim otherwise.
  if (operation === 'update' && originalDoc?.status === 'approved' && data.status !== undefined && data.status !== 'approved') {
    throw invalid('status', MESSAGES.approvedIsFinal[type === 'claim' ? 'claim' : 'listing'])
  }

  if (type === 'claim' && becomesApproved(operation, data.status ?? originalDoc?.status, originalDoc?.status)) {
    const isTemplate = (data.kind ?? originalDoc?.kind) === 'template'
    const field = isTemplate ? 'template' : 'plugin'
    const listingId = relationId(data[field] ?? originalDoc?.[field])
    // System lookup (overrideAccess): the approving admin may approve claims on hidden listings; trashed ones are excluded by default.
    const found =
      listingId === undefined
        ? null
        : await req.payload.find({ collection: isTemplate ? 'templates' : 'plugins', where: { id: { equals: listingId } }, select: {}, limit: 1, depth: 0, overrideAccess: true, req })
    if (!found?.docs[0]) throw invalid(field, isTemplate ? MESSAGES.claimTemplateGone : MESSAGES.claimPluginGone)
    return data
  }
  if (type !== 'listing' || !becomesApproved(operation, data.status ?? originalDoc?.status, originalDoc?.status)) return data

  if ((data.kind ?? originalDoc?.kind) === 'template') {
    // Templates are GitHub-only: the repository (and folder) come straight from the URL, no registry call.
    const target = parseTemplateSubmissionUrl(String(data.url ?? originalDoc?.url ?? ''))
    const fullName = data.repositoryFullName || originalDoc?.repositoryFullName
    // A submission an admin created by hand may carry the folder only in its URL (`/tree/<ref>/<path>`).
    const sameRepo = !fullName || fullName.toLowerCase() === target?.fullName.toLowerCase()
    if (!(data.path ?? originalDoc?.path) && target?.path && sameRepo) data.path = target.path
    if (fullName) return data
    if (!target) throw invalid('repositoryFullName', MESSAGES.unresolvedRepository)
    data.repositoryFullName = target.fullName
    return data
  }
  if (data.repositoryFullName || originalDoc?.repositoryFullName) return data

  const target = parseSubmissionUrl(String(data.url ?? originalDoc?.url ?? ''))
  let fullName: string | null = null
  let registryFailed = false
  if (target?.kind === 'github') fullName = target.fullName
  if (target?.kind === 'npm') {
    // Test seam: Local API callers may pass a resolver in `context`; REST callers cannot set context.
    const resolve = (req.context.npmRepositoryResolver as NpmRepositoryResolver | undefined) ?? createNpmRepositoryResolver()
    try {
      fullName = await resolve(target.packageName)
    } catch (err) {
      // Registry outage or rate limit: stay pending; the admin can retry or enter owner/repo by hand.
      registryFailed = true
      req.payload.logger.warn({ err }, 'approval: npm registry lookup failed')
    }
  }
  if (!fullName) {
    throw invalid('repositoryFullName', registryFailed ? MESSAGES.registryUnavailable : MESSAGES.unresolvedRepository)
  }
  data.repositoryFullName = fullName
  return data
}

async function addMaintainer(
  req: PayloadRequest,
  collection: 'plugins' | 'templates',
  listingId: number | undefined,
  maintainerId: number | undefined,
) {
  if (listingId === undefined || maintainerId === undefined) return
  const listing = await req.payload.findByID({ collection, id: listingId, depth: 0, overrideAccess: true, req, disableErrors: true })
  if (!listing) return
  const current = (listing.maintainers ?? []).map(relationId).filter((id): id is number => id !== undefined)
  if (current.includes(maintainerId)) return
  // System write on approval: maintainers can never edit `maintainers` themselves (plugins or templates).
  // No `skipRevalidate` here: in Payload v4 a Local API `context` is merged into the shared `req.context`, so the flag
  // would leak to every later write on this request. `revalidatePluginChange` instead skips a save whose only change is
  // `maintainers` (not rendered on any public page), decided per document; `revalidateTemplateChange` does the same.
  // Known race (accepted): the maintainers array is read then written in full, so two claims for the SAME listing approved
  // at the exact same moment could lose one grant. Approvals are admin-only and rare; sequential approvals are safe.
  await req.payload.update({
    collection,
    id: listingId,
    data: { maintainers: [...current, maintainerId] },
    depth: 0,
    overrideAccess: true,
    req,
  })
}

/**
 * An approved template listing links the existing template of that repository + folder, or queues `sync-template`
 * (which links it once the template is created). Like a plugin listing, it never grants maintainer rights.
 */
async function approveTemplateListing(req: PayloadRequest, doc: Submission, fullName: string): Promise<Submission> {
  if (doc.template) return doc
  const path = doc.path || null
  const template = await findTemplateForRepositoryPath(req.payload, fullName, path, req)
  if (template) {
    // System write: `template` is admin-only and set here only on the approval transition.
    await req.payload.update({ collection: 'submissions', id: doc.id, data: { template: template.id }, depth: 0, overrideAccess: true, req })
    doc.template = template.id
    return doc
  }
  await enqueueTemplateSync(req, fullName, path)
  return doc
}

/** Spec §9: approving a claim adds the maintainer (to the plugin or the template, by kind); approving a listing links the plugin and enqueues a sync. */
export const applyApproval: CollectionAfterChangeHook<Submission> = async ({ doc, operation, previousDoc, req }) => {
  if (!becomesApproved(operation, doc.status, previousDoc?.status)) return doc

  if (doc.type === 'claim') {
    if (doc.kind === 'template') await addMaintainer(req, 'templates', relationId(doc.template), relationId(doc.submittedBy))
    else await addMaintainer(req, 'plugins', relationId(doc.plugin), relationId(doc.submittedBy))
    return doc
  }

  const fullName = doc.repositoryFullName
  if (!fullName) return doc
  if (doc.kind === 'template') return approveTemplateListing(req, doc, fullName)
  if (!doc.plugin) {
    const plugin = await findPluginForRepository(req.payload, fullName, req)
    if (plugin) {
      // System write: `plugin` is a link the approving admin should not have to pick by hand; the field is not
      // editable by maintainers, and this runs only on the approval transition.
      await req.payload.update({ collection: 'submissions', id: doc.id, data: { plugin: plugin.id }, depth: 0, overrideAccess: true, req })
      doc.plugin = plugin.id
    }
  }
  await enqueueRepositorySync(req, fullName)
  return doc
}
