import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import { revalidateTemplateCategoryChange, revalidateTemplateCategoryDelete } from '@/collections/hooks/revalidateTemplate'
import { markTaxonomyEdited } from '@/taxonomy/hooks'
import { validateTaxonomySlug } from '@/taxonomy/slugs'

/** The template category tree (Phase 6). Same shape as `categories`; no search hooks (templates arrive in Task 13). */
export const TemplateCategories: CollectionConfig = {
  slug: 'template-categories',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  hierarchy: { parentFieldName: 'parent', slugField: 'slug' },
  hooks: {
    afterChange: [revalidateTemplateCategoryChange],
    afterDelete: [markTaxonomyEdited, revalidateTemplateCategoryDelete],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (value: unknown) => validateTaxonomySlug(value) },
    { name: 'intro', type: 'textarea', admin: { description: 'SEO paragraph shown on the category page.' } },
    { name: 'icon', type: 'text', admin: { description: 'lucide-react icon name, e.g. "database".' } },
    ...adminOnlyAuthorship(),
  ],
}
