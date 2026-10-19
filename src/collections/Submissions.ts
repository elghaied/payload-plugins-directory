import type { CollectionBeforeChangeHook, CollectionConfig, PayloadRequest } from 'payload'
import { ValidationError } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import { relationId } from '@/lib/relationId'
import { findListingConflict, MAX_PENDING_PER_MAINTAINER } from '@/lib/submissions/duplicates'
import { MESSAGES } from '@/lib/submissions/messages'
import { FULL_NAME_RE, parseSubmissionUrl } from '@/lib/submissions/url'
import { listedPluginsWhere } from './Plugins'

const invalid = (req: PayloadRequest, path: string, message: string) =>
  new ValidationError({ collection: 'submissions', errors: [{ path, message }], req })

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
    delete data.plugin // only an admin links the resulting plugin
    const target = parseSubmissionUrl(typeof data.url === 'string' ? data.url : '')
    if (!target) throw invalid(req, 'url', MESSAGES.invalidUrl)
    data.url = target.canonicalUrl
    const conflict = await findListingConflict(req.payload, target, req)
    if (conflict?.kind === 'listed') throw invalid(req, 'url', MESSAGES.listed(conflict.name))
    if (conflict) throw invalid(req, 'url', MESSAGES[conflict.kind])
    return data
  }

  // claim
  delete data.url
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
  admin: { useAsTitle: 'url', group: 'Community', defaultColumns: ['type', 'url', 'status', 'createdAt'] },
  versions: true,
  access: {
    read: ({ req }) =>
      isAdminUser(req.user) ||
      (req.user?.collection === 'maintainers' ? { submittedBy: { equals: req.user.id } } : false),
    create: ({ req }) => isAdminUser(req.user) || req.user?.collection === 'maintainers',
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: { beforeChange: [enforceOwnership] },
  fields: [
    { name: 'type', type: 'select', required: true, defaultValue: 'listing', options: ['listing', 'claim'] },
    {
      name: 'url',
      type: 'text',
      admin: { condition: (data) => data?.type === 'listing' },
      validate: (value: unknown, { siblingData }: { siblingData?: { type?: string } }) =>
        siblingData?.type !== 'listing' || (typeof value === 'string' && parseSubmissionUrl(value) !== null) || MESSAGES.invalidUrl,
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
      validate: (value: unknown) =>
        value == null || value === '' || (typeof value === 'string' && FULL_NAME_RE.test(value)) || 'Use owner/repo in lower case.',
    },
    { name: 'plugin', type: 'relationship', relationTo: 'plugins' },
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
    { name: 'rejectionReason', type: 'textarea', access: { create: adminOnly, update: adminOnly } },
    ...adminOnlyAuthorship(),
  ],
}
