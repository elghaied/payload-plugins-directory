import type { CollectionConfig } from 'payload'
import { isAdmin } from '@/access'

export const Maintainers: CollectionConfig = {
  slug: 'maintainers',
  admin: { useAsTitle: 'login', group: 'Community' },
  auth: { disableLocalStrategy: true, strategies: [] },
  access: {
    read: ({ req }) => isAdmin({ req } as never) || (req.user?.collection === 'maintainers' ? { id: { equals: req.user.id } } : false),
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
    admin: () => false,
  },
  fields: [
    { name: 'githubId', type: 'number', required: true, unique: true, index: true },
    { name: 'login', type: 'text', required: true, index: true },
    { name: 'name', type: 'text' },
    { name: 'avatarUrl', type: 'text' },
  ],
}
