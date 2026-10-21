import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { adminOnlyAuthorship } from '@/fields/authorship'
import {
  forgetSyncedDoc,
  rememberPluginsBeforeTaxonomyDelete,
  resyncPluginsAfterTaxonomyDelete,
  resyncPluginsOnTaxonomyChange,
} from '@/lib/search/hooks'
import { CATEGORIES_LLM_INSTRUCTIONS } from '@/mcp/instructions'
import { markTaxonomyEdited, revalidateCategoryChange, revalidateCategoryDelete } from '@/taxonomy/hooks'
import { validateTaxonomySlug } from '@/taxonomy/slugs'

export const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  // slugField: `_h_slugPath` is built from our slugs (default: slugified titles), so /categories/<path> URLs
  // stay stable when an admin retitles a category.
  hierarchy: { parentFieldName: 'parent', slugField: 'slug' },
  llmInstructions: CATEGORIES_LLM_INSTRUCTIONS,
  hooks: {
    // plugin-search's own afterChange runs after these, so forgetting the synced-doc key here makes every edit sync.
    afterChange: [revalidateCategoryChange, forgetSyncedDoc('categories'), resyncPluginsOnTaxonomyChange('categories')],
    beforeDelete: [rememberPluginsBeforeTaxonomyDelete('categories')],
    afterDelete: [markTaxonomyEdited, revalidateCategoryDelete, resyncPluginsAfterTaxonomyDelete('categories')],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (value: unknown) => validateTaxonomySlug(value) },
    { name: 'intro', type: 'textarea', admin: { description: 'SEO paragraph shown on the category page.' } },
    { name: 'icon', type: 'text', admin: { description: 'lucide-react icon name, e.g. "database".' } },
    ...adminOnlyAuthorship(),
  ],
}
