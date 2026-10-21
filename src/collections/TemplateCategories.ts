import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import { revalidateTemplateCategoryChange, revalidateTemplateCategoryDelete } from '@/collections/hooks/revalidateTemplate'
import {
  rememberPluginsBeforeTaxonomyDelete,
  resyncPluginsAfterTaxonomyDelete,
  resyncPluginsOnTaxonomyChange,
} from '@/lib/search/hooks'
import { markTaxonomyEdited } from '@/taxonomy/hooks'
import { validateTaxonomySlug } from '@/taxonomy/slugs'

/**
 * The template category tree (Phase 6). Same shape as `categories`. Not indexed itself; a rename, move or delete
 * queues a resync of the template rows that embed its title path.
 */
export const TemplateCategories: CollectionConfig = {
  slug: 'template-categories',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  hierarchy: { parentFieldName: 'parent', slugField: 'slug' },
  hooks: {
    afterChange: [revalidateTemplateCategoryChange, resyncPluginsOnTaxonomyChange('template-categories')],
    beforeDelete: [rememberPluginsBeforeTaxonomyDelete('template-categories')],
    afterDelete: [markTaxonomyEdited, revalidateTemplateCategoryDelete, resyncPluginsAfterTaxonomyDelete('template-categories')],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (value: unknown) => validateTaxonomySlug(value) },
    { name: 'intro', type: 'textarea', admin: { description: 'SEO paragraph shown on the category page.' } },
    { name: 'icon', type: 'text', admin: { description: 'lucide-react icon name, e.g. "database".' } },
    ...adminOnlyAuthorship(),
  ],
}
