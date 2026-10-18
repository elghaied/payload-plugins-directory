import type { CollectionConfig } from 'payload'
import { isAdmin } from '@/access'

export const Users: CollectionConfig = {
  slug: 'users',
  admin: { useAsTitle: 'email', group: 'System' },
  // Secure-only session cookie when served over HTTPS (production builds); plain http in dev/tests.
  auth: { cookies: { secure: process.env.NODE_ENV === 'production' } },
  access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin },
  versions: false,
  fields: [],
}
