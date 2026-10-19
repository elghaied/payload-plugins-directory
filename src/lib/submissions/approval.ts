import type { CollectionAfterChangeHook, CollectionBeforeChangeHook, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import { createNpmRepositoryResolver, type NpmRepositoryResolver } from '@/lib/npm/repository'
import { relationId } from '@/lib/relationId'
import type { Submission } from '@/payload-types'
import { findPluginForRepository } from './duplicates'
import { enqueueRepositorySync } from './enqueueSync'
import { MESSAGES } from './messages'
import { parseSubmissionUrl } from './url'

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
  if (type !== 'listing' || !becomesApproved(operation, data.status ?? originalDoc?.status, originalDoc?.status)) return data
  if (data.repositoryFullName || originalDoc?.repositoryFullName) return data

  const target = parseSubmissionUrl(String(data.url ?? originalDoc?.url ?? ''))
  let fullName: string | null = null
  if (target?.kind === 'github') fullName = target.fullName
  if (target?.kind === 'npm') {
    // Test seam: Local API callers may pass a resolver in `context`; REST callers cannot set context.
    const resolve = (req.context.npmRepositoryResolver as NpmRepositoryResolver | undefined) ?? createNpmRepositoryResolver()
    try {
      fullName = await resolve(target.packageName)
    } catch (err) {
      // Registry outage or rate limit: stay pending; the admin can retry or enter owner/repo by hand.
      req.payload.logger.warn({ err }, 'approval: npm registry lookup failed')
    }
  }
  if (!fullName) {
    throw new ValidationError({ collection: 'submissions', errors: [{ path: 'repositoryFullName', message: MESSAGES.unresolvedRepository }], req })
  }
  data.repositoryFullName = fullName
  return data
}

async function addMaintainer(req: PayloadRequest, pluginId: number | undefined, maintainerId: number | undefined) {
  if (pluginId === undefined || maintainerId === undefined) return
  const plugin = await req.payload.findByID({ collection: 'plugins', id: pluginId, depth: 0, overrideAccess: true, req, disableErrors: true })
  if (!plugin) return
  const current = (plugin.maintainers ?? []).map(relationId).filter((id): id is number => id !== undefined)
  if (current.includes(maintainerId)) return
  // System write on approval: maintainers can never edit `maintainers` themselves.
  // `maintainers` is not rendered on any public page or cached query, so this write skips the revalidate job
  // (ruling F10). The context is a copy of the request's, so nothing the caller set is lost.
  await req.payload.update({
    collection: 'plugins',
    id: pluginId,
    data: { maintainers: [...current, maintainerId] },
    depth: 0,
    overrideAccess: true,
    req,
    context: { ...req.context, skipRevalidate: true },
  })
}

/** Spec §9: approving a claim adds the maintainer; approving a listing links the plugin and enqueues a sync. */
export const applyApproval: CollectionAfterChangeHook<Submission> = async ({ doc, operation, previousDoc, req }) => {
  if (!becomesApproved(operation, doc.status, previousDoc?.status)) return doc

  if (doc.type === 'claim') {
    await addMaintainer(req, relationId(doc.plugin), relationId(doc.submittedBy))
    return doc
  }

  const fullName = doc.repositoryFullName
  if (!fullName) return doc
  if (!doc.plugin) {
    const plugin = await findPluginForRepository(req.payload, fullName, req)
    if (plugin) {
      await req.payload.update({ collection: 'submissions', id: doc.id, data: { plugin: plugin.id }, depth: 0, overrideAccess: true, req })
      doc.plugin = plugin.id
    }
  }
  await enqueueRepositorySync(req, fullName)
  return doc
}
