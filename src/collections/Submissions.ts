import type { CollectionBeforeChangeHook, CollectionConfig } from 'payload'
import { ValidationError } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'
import { listedPluginsWhere } from './Plugins'

const relationId = (value: unknown): number | string | undefined =>
  typeof value === 'object' && value !== null ? (value as { id?: number | string }).id : (value as number | string | undefined)

// Field-level access on `submittedBy` strips client values for non-admins (it runs in the
// beforeValidate field pass); this collection hook runs afterwards and stamps the real owner.
const enforceOwnership: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
  if (operation !== 'create' || isAdminUser(req.user) || !req.user) return data
  data.submittedBy = req.user.id

  if (data.type === 'claim') {
    const pluginId = relationId(data.plugin)
    const found =
      pluginId === undefined
        ? null
        : await req.payload.find({
            collection: 'plugins',
            where: { and: [{ id: { equals: pluginId } }, listedPluginsWhere] },
            limit: 1,
            depth: 0,
            overrideAccess: true,
            req,
          })
    if (!found?.docs.length) {
      throw new ValidationError({
        collection: 'submissions',
        errors: [{ path: 'plugin', message: 'A claim must reference a listed plugin.' }],
        req,
      })
    }
  }
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
    { name: 'url', type: 'text', admin: { condition: (data) => data?.type === 'listing' } },
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
  ],
}
