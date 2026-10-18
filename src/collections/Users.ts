import type { CollectionConfig } from 'payload'
import { isAdmin } from '@/access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', group: 'System' },
  auth: true,
  access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
  versions: false,
  fields: [],
}
