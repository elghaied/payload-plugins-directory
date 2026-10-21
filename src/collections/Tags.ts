import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { adminOnlyUpdatedBy } from '@/fields/authorship'
import {
  forgetSyncedDoc,
  rememberPluginsBeforeTaxonomyDelete,
  resyncPluginsAfterTaxonomyDelete,
  resyncPluginsOnTaxonomyChange,
} from '@/lib/search/hooks'
import { revalidateTagChange, revalidateTagDelete } from '@/taxonomy/hooks'
import { validateTaxonomySlug } from '@/taxonomy/slugs'

export const Tags: CollectionConfig = {
  slug: 'tags',
  admin: { useAsTitle: 'title', group: 'Taxonomy' },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  tags: true,
  hooks: {
    afterChange: [revalidateTagChange, forgetSyncedDoc('tags'), resyncPluginsOnTaxonomyChange('tags')],
    beforeDelete: [rememberPluginsBeforeTaxonomyDelete('tags')],
    afterDelete: [revalidateTagDelete, resyncPluginsAfterTaxonomyDelete('tags')],
  },
  fields: [
    { name: 'title', type: 'text', required: true },
    { name: 'slug', type: 'text', required: true, unique: true, index: true, validate: (value: unknown) => validateTaxonomySlug(value) },
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
    // `createdBy` above is the tag's origin (and replaces v4's authorship createdBy); hide updatedBy.
    adminOnlyUpdatedBy(),
  ],
}
