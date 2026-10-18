import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  hierarchy: { parentFieldName: 'parent' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'intro', type: 'textarea', admin: { description: 'SEO paragraph shown on the category page.' } },
    { name: 'icon', type: 'text', admin: { description: 'lucide-react icon name, e.g. "database".' } },
  ],
}
