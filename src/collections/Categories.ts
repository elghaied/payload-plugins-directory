import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import { validateTaxonomySlug } from '@/taxonomy/slugs'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  // slugField: `_h_slugPath` is built from our slugs (default: slugified titles), so /categories/<path> URLs
  // stay stable when an admin retitles a category.
  hierarchy: { parentFieldName: 'parent', slugField: 'slug' },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (value: unknown) => validateTaxonomySlug(value) },
    { name: 'intro', type: 'textarea', admin: { description: 'SEO paragraph shown on the category page.' } },
    { name: 'icon', type: 'text', admin: { description: 'lucide-react icon name, e.g. "database".' } },
    ...adminOnlyAuthorship(),
  ],
}
