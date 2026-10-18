import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'System' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  upload: { staticDir: process.env.MEDIA_DIR || 'media', mimeTypes: ['image/*'] },
  fields: [{ name: 'alt', type: 'text', required: true }],
}
