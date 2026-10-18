import type { CollectionSlug, GlobalConfig } from 'payload'
import { adminOnly, anyone, isAdmin } from '@/access'

export const DirectorySettings: GlobalConfig = {
  slug: 'directory-settings',
  admin: { group: 'System' },
  access: { read: anyone, update: isAdmin },
  fields: [
    { name: 'featuredPlugins', type: 'relationship', // TODO(task 5): drop the cast once the `plugins` collection exists.
      relationTo: 'plugins' as CollectionSlug, hasMany: true },
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
        { name: 'instructions', type: 'textarea' },
        { name: 'maxNewTagsPerPlugin', type: 'number', defaultValue: 2, min: 0, max: 5 },
      ],
    },
  ],
}
