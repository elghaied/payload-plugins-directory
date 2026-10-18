import type { CollectionConfig } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'

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
  fields: [
    { name: 'type', type: 'select', required: true, defaultValue: 'listing', options: ['listing', 'claim'] },
    { name: 'url', type: 'text', admin: { condition: (data) => data?.type === 'listing' } },
    { name: 'plugin', type: 'relationship', relationTo: 'plugins' },
    { name: 'submittedBy', type: 'relationship', relationTo: 'maintainers', required: true },
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
