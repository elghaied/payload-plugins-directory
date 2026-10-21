import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import { relationId } from '@/lib/relationId'
import { applyApproval, resolveApprovedListing } from '@/lib/submissions/approval'
import { findListingConflict, MAX_PENDING_PER_MAINTAINER, type ListingConflict, type ListingKind } from '@/lib/submissions/duplicates'
import { MESSAGES } from '@/lib/submissions/messages'
import { FULL_NAME_RE, parseSubmissionUrl, parseTemplateSubmissionUrl, validTemplatePath } from '@/lib/submissions/url'
import { listedPluginsWhere } from './Plugins'

const invalid = (req: PayloadRequest, path: string, message: string) =>
  new ValidationError({ collection: 'submissions', errors: [{ path, message }], req })

function throwConflict(req: PayloadRequest, conflict: ListingConflict | null, kind: ListingKind): void {
  if (!conflict) return
  if (conflict.kind === 'listed') throw invalid(req, 'url', kind === 'template' ? MESSAGES.templateListed(conflict.name) : MESSAGES.listed(conflict.name))
  if (conflict.kind === 'otherType') throw invalid(req, 'url', MESSAGES.otherType(conflict.existingType, conflict.name))
  if (conflict.kind === 'pending') throw invalid(req, 'url', kind === 'template' ? MESSAGES.templatePending : MESSAGES.pending)
  throw invalid(req, 'url', MESSAGES[conflict.kind])
}

// Field-level access strips client values of admin-only fields for non-admins (beforeValidate field pass);
// this collection hook runs afterwards, stamps the real owner and enforces the maintainer-side rules.
const enforceOwnership: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create' || isAdminUser(req.user) || !req.user) return data
  const maintainerId = req.user.id
  data.submittedBy = maintainerId

  const pending = await req.payload.count({
    collection: 'submissions',
    where: { and: [{ submittedBy: { equals: maintainerId } }, { status: { equals: 'pending' } }] },
    overrideAccess: true,
    req,
  })
  if (pending.totalDocs >= MAX_PENDING_PER_MAINTAINER) throw invalid(req, 'type', MESSAGES.tooMany)

  if (data.type === 'listing') {
    delete data.plugin // only an admin (or sync) links the resulting plugin or template
    delete data.template
    const url = typeof data.url === 'string' ? data.url : ''
    if (data.kind === 'template') {
      // GitHub only; `path` always comes from the URL, never from the client.
      const target = parseTemplateSubmissionUrl(url)
      if (!target) throw invalid(req, 'url', MESSAGES.templateNeedsGitHub)
      data.url = target.canonicalUrl
      data.path = target.path
      throwConflict(req, await findListingConflict(req.payload, target, req, 'template'), 'template')
      return data
    }
    data.kind = 'plugin'
    delete data.path
    const target = parseSubmissionUrl(url)
    if (!target) throw invalid(req, 'url', MESSAGES.invalidUrl)
    data.url = target.canonicalUrl
    throwConflict(req, await findListingConflict(req.payload, target, req), 'plugin')
    return data
  }

  // claim (claims are for plugins)
  delete data.url
  delete data.path
  delete data.template
  data.kind = 'plugin'
  const pluginId = relationId(data.plugin)
  const found =
    pluginId === undefined
      ? null
      : await req.payload.find({
          collection: 'plugins',
          where: { and: [{ id: { equals: pluginId } }, listedPluginsWhere] },
          select: { maintainers: true },
          limit: 1,
          depth: 0,
          overrideAccess: true,
          req,
        })
  const plugin = found?.docs[0]
  if (!plugin) throw invalid(req, 'plugin', MESSAGES.claimNotListed)
  if ((plugin.maintainers ?? []).map(relationId).includes(maintainerId)) throw invalid(req, 'plugin', MESSAGES.alreadyMaintainer)
  const open = await req.payload.count({
    collection: 'submissions',
    where: {
      and: [
        { type: { equals: 'claim' } },
        { plugin: { equals: pluginId } },
        { submittedBy: { equals: maintainerId } },
        { status: { equals: 'pending' } },
      ],
    },
    overrideAccess: true,
    req,
  })
  if (open.totalDocs) throw invalid(req, 'plugin', MESSAGES.claimPending)
  return data
}

export const Submissions: CollectionConfig = {
  slug: 'submissions',
  admin: { useAsTitle: 'url', group: 'Community', defaultColumns: ['type', 'kind', 'url', 'status', 'createdAt'] },
  versions: true,
  access: {
    read: ({ req }) =>
      isAdminUser(req.user) ||
      (req.user?.collection === 'maintainers' ? { submittedBy: { equals: req.user.id } } : false),
    create: ({ req }) => isAdminUser(req.user) || req.user?.collection === 'maintainers',
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: { beforeChange: [enforceOwnership, resolveApprovedListing], afterChange: [applyApproval] },
  fields: [
    { name: 'type', type: 'select', required: true, defaultValue: 'listing', options: ['listing', 'claim'] },
    {
      // What a listing asks for. Maintainers choose it on create; only admins change it afterwards.
      name: 'kind',
      type: 'select',
      required: true,
      defaultValue: 'plugin',
      index: true,
      options: ['plugin', 'template'],
      admin: { condition: (data) => data?.type === 'listing' },
      access: { update: adminOnly },
    },
    {
      name: 'url',
      type: 'text',
      admin: { condition: (data) => data?.type === 'listing' },
      validate: (value: unknown, { siblingData }: { siblingData?: { type?: string; kind?: string } }) => {
        if (siblingData?.type !== 'listing') return true
        if (siblingData.kind === 'template') {
          return (typeof value === 'string' && parseTemplateSubmissionUrl(value) !== null) || MESSAGES.templateNeedsGitHub
        }
        return (typeof value === 'string' && parseSubmissionUrl(value) !== null) || MESSAGES.invalidUrl
      },
    },
    {
      // Template folder within the repository (null = the repository root). Set from the URL on a maintainer's create.
      name: 'path',
      type: 'text',
      maxLength: 300,
      admin: {
        condition: (data) => data?.type === 'listing' && data?.kind === 'template',
        description: 'Template folder within the repository; empty for the repository root.',
      },
      access: { update: adminOnly },
      hooks: { beforeValidate: [({ value }) => (typeof value === 'string' && value.trim() === '' ? null : value)] },
      validate: (value: unknown) =>
        value == null || (typeof value === 'string' && validTemplatePath(value)) || 'Use a folder path such as apps/site (letters, digits, ".", "_", "-").',
    },
    {
      name: 'repositoryFullName',
      type: 'text',
      index: true,
      admin: {
        condition: (data) => data?.type === 'listing',
        description: 'owner/repo (lower-case). Filled on approval; enter it by hand when an npm package cannot be resolved.',
      },
      access: { create: adminOnly, update: adminOnly },
      // Runs before validation, so an admin may type `Owner/Repo` and it is stored as `owner/repo`.
      hooks: { beforeValidate: [({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value)] },
      validate: (value: unknown) =>
        value == null || value === '' || (typeof value === 'string' && FULL_NAME_RE.test(value)) || 'Use owner/repo in lower case.',
    },
    { name: 'plugin', type: 'relationship', relationTo: 'plugins' },
    {
      // Linked by approval or by template sync; never set by a maintainer.
      name: 'template',
      type: 'relationship',
      relationTo: 'templates',
      admin: { condition: (data) => data?.type === 'listing' && data?.kind === 'template' },
      access: { create: adminOnly, update: adminOnly },
    },
    {
      name: 'submittedBy',
      type: 'relationship',
      relationTo: 'maintainers',
      required: true,
      access: { create: adminOnly, update: adminOnly },
    },
    { name: 'note', type: 'textarea', maxLength: 1000 },
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'pending',
      options: ['pending', 'approved', 'rejected', 'duplicate'],
      access: { create: adminOnly, update: adminOnly },
    },
    {
      name: 'lastClaimCheckAt',
      type: 'date',
      admin: { hidden: true, readOnly: true, condition: (data) => data?.type === 'claim' },
      access: { create: adminOnly, update: adminOnly }, // readable by the owner: claimPlugin reads it as the maintainer
    },
    { name: 'rejectionReason', type: 'textarea', access: { create: adminOnly, update: adminOnly } },
    ...adminOnlyAuthorship(),
  ],
}
