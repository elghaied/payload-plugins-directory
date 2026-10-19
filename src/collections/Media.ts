import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'

export const Media: CollectionConfig = {
  slug: 'media',
  admin: { group: 'System' },
  versions: false,
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  // Raster images only: SVG can carry script and is served from this origin.
  upload: {
    staticDir: process.env.MEDIA_DIR || 'media',
    // Files are served from this origin: never let a browser guess a different type.
    modifyResponseHeaders: ({ headers }) => {
      headers.set('X-Content-Type-Options', 'nosniff')
      return headers
    },
    mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'],
  },
  fields: [{ name: 'alt', type: 'text', required: true }, ...adminOnlyAuthorship()],
}
