import type { Access, CollectionConfig } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import { githubSessionStrategy } from '@/lib/auth/strategy'

/** Admins: everything. Maintainers: their own document only (spec §9.1). */
const selfOrAdmin: Access = ({ req }) =>
  isAdminUser(req.user) || (req.user?.collection === 'maintainers' ? { id: { equals: req.user.id } } : false)

// Identity comes from GitHub at sign-in (written by the OAuth callback with overrideAccess) and is never
// user-editable. Non-identity fields added later are self-editable by default through `update: selfOrAdmin`.
const identity = { access: { create: adminOnly, update: adminOnly } }
// Moderation state: invisible to and unwritable by maintainers.
const adminOnlyField = { access: { create: adminOnly, read: adminOnly, update: adminOnly } }

export const Maintainers: CollectionConfig = {
  slug: 'maintainers',
  admin: { useAsTitle: 'login', group: 'Community' },
  auth: { disableLocalStrategy: true, strategies: [githubSessionStrategy] },
  versions: false,
  access: {
    read: selfOrAdmin,
    create: isAdmin,
    update: selfOrAdmin,
    delete: isAdmin,
    admin: () => false,
  },
  fields: [
    { name: 'githubId', type: 'number', required: true, unique: true, index: true, ...identity },
    { name: 'login', type: 'text', required: true, index: true, ...identity },
    { name: 'name', type: 'text', ...identity },
    { name: 'avatarUrl', type: 'text', ...identity },
    { name: 'blocked', type: 'checkbox', defaultValue: false, ...adminOnlyField },
    {
      name: 'sessionsValidAfter',
      type: 'date',
      admin: { description: 'Sessions issued before this moment are rejected. Bumped on logout.' },
      ...adminOnlyField,
    },
    ...adminOnlyAuthorship(),
  ],
}
