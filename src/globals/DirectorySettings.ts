import type { GlobalConfig } from 'payload'
import { adminOnly, anyone, isAdmin } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'

export const DirectorySettings: GlobalConfig = {
  slug: 'directory-settings',
  admin: { group: 'System' },
  versions: false, // version endpoints could otherwise expose the admin-only `ai` group
  access: { read: anyone, update: isAdmin },
  fields: [
    { name: 'featuredPlugins', type: 'relationship', relationTo: 'plugins', hasMany: true },
    {
      name: 'announcement',
      type: 'group',
      fields: [
        { name: 'text', type: 'text' },
        { name: 'link', type: 'text' },
      ],
    },
    {
      name: 'ai',
      type: 'group',
      access: { read: adminOnly },
      fields: [
        { name: 'enabled', type: 'checkbox', defaultValue: true },
        { name: 'model', type: 'text', defaultValue: 'claude-sonnet-5-5' },
        { name: 'instructions', type: 'textarea', maxLength: 2000 },
        { name: 'maxNewTagsPerPlugin', type: 'number', defaultValue: 2, min: 0, max: 5 },
      ],
    },
    ...adminOnlyAuthorship(),
  ],
}
