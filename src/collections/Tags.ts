import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'

export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  tags: true,
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    {
      name: 'aliases',
      type: 'text',
      hasMany: true,
      admin: { description: 'GitHub topics / npm keywords that map to this tag.' },
    },
    {
      name: 'createdBy',
      type: 'select',
      defaultValue: 'admin',
      options: ['admin', 'alias', 'ai'],
      admin: { position: 'sidebar' },
    },
  ],
}
