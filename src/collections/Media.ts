import type { CollectionConfig } from 'payload'
import { adminOnly, anyone, isAdmin } from '@/access'
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
  fields: [
    { name: 'alt', type: 'text', required: true },
    {
      // Who put the file here. The orphan sweep (src/lib/maintainers/mediaCleanup.ts) only ever deletes 'maintainer' rows,
      // so admin uploads (and any future non-logo relation to media) are never swept. Set by saveBranding only.
      name: 'origin',
      type: 'select',
      options: ['maintainer', 'admin'],
      defaultValue: 'admin',
      index: true,
      admin: { hidden: true, readOnly: true },
      access: { read: adminOnly, create: adminOnly, update: adminOnly },
    },
    ...adminOnlyAuthorship(),
  ],
}
