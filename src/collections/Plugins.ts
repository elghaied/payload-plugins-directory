import type { CollectionConfig, Where } from 'payload'
import { createTagField } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'
import { linkApprovedSubmissions } from '@/collections/hooks/linkApprovedSubmissions'
import { restrictMaintainerPluginEdits } from '@/collections/hooks/restrictMaintainerPluginEdits'
import { revalidatePluginChange, revalidatePluginDelete } from '@/collections/hooks/revalidatePlugin'
import { lockAdminEditedAiFields } from '@/enrich/locks'
import { forgetSyncedDoc, removeUnlistedPluginFromSearch } from '@/lib/search/hooks'
import { normalizeTagline } from '@/lib/maintainers/tagline'
import { PLUGINS_LLM_INSTRUCTIONS } from '@/mcp/instructions'
import { DESCRIPTION_MAX_CHARS, README_MAX_CHARS } from '@/sync/limits'

export const listedPluginsWhere: Where = {
  and: [{ visibility: { equals: 'listed' } }, { deletedAt: { exists: false } }],
}

const aiLockable = ['category', 'tags', 'tagline', 'summary', 'features', 'useCases'] as const

export const Plugins: CollectionConfig = {
  slug: 'plugins',
  admin: {
    useAsTitle: 'name',
    group: 'Directory',
    defaultColumns: ['name', 'slug', 'category', 'healthScore', 'visibility'],
  },
  versions: false,
  authorship: false, // system-synced; no per-user attribution to track (or leak)
  trash: true,
  llmInstructions: PLUGINS_LLM_INSTRUCTIONS,
  enableQueryPresets: true,
  access: {
    read: ({ req }) => (isAdminUser(req.user) ? true : listedPluginsWhere),
    create: isAdmin,
    // Maintainers: only listed plugins they maintain. Which fields is enforced by restrictMaintainerPluginEdits.
    update: ({ req }) => {
      if (isAdminUser(req.user)) return true
      if (req.user?.collection === 'maintainers') {
        return { and: [listedPluginsWhere, { maintainers: { in: [req.user.id] } }] }
      }
      return false
    },
    delete: isAdmin,
  },
  hooks: {
    beforeOperation: [restrictMaintainerPluginEdits],
    beforeChange: [
      // A trash/restore that does not come from the sync trash helper is an admin decision: drop sync's
      // reason so sync never treats an admin-trashed plugin as its own (and restores it).
      ({ data, originalDoc, context }) => {
        if (context.syncTrash || !('deletedAt' in data)) return data
        if (Boolean(data.deletedAt) !== Boolean(originalDoc?.deletedAt)) data.syncTrashReason = null
        return data
      },
      lockAdminEditedAiFields,
    ],
    afterChange: [revalidatePluginChange, linkApprovedSubmissions, removeUnlistedPluginFromSearch, forgetSyncedDoc('plugins')],
    afterDelete: [revalidatePluginDelete],
  },
  fields: [
    // Identity
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'packageName', type: 'text', index: true },
    { name: 'repository', type: 'relationship', relationTo: 'repositories', required: true, index: true },
    { name: 'path', type: 'text', admin: { description: 'Monorepo subdirectory; empty for single-package repos.' } },
    { name: 'url', type: 'text', required: true },
    { name: 'isOfficial', type: 'checkbox', defaultValue: false, index: true },
    { name: 'source', type: 'select', required: true, defaultValue: 'topic', options: ['topic', 'official', 'submission'] },
    { name: 'firstSeenAt', type: 'date' },
    // Source content
    { name: 'description', type: 'textarea', maxLength: DESCRIPTION_MAX_CHARS },
    { name: 'keywords', type: 'text', hasMany: true, admin: { readOnly: true, description: 'npm keywords (written by sync).' } },
    { name: 'readme', type: 'textarea', maxLength: README_MAX_CHARS },
    { name: 'readmeTruncated', type: 'checkbox', defaultValue: false, admin: { readOnly: true, description: 'Set by sync when the README was cut at the storage limit.' } },
    { name: 'contentHash', type: 'text', admin: { readOnly: true } },
    // Compatibility
    { name: 'payloadVersionRange', type: 'text' },
    {
      name: 'payloadMajors',
      type: 'select',
      hasMany: true,
      index: true,
      options: ['1', '2', '3', '4', 'unknown'],
    },
    // npm
    {
      name: 'npm',
      type: 'group',
      fields: [
        { name: 'weeklyDownloads', type: 'number' },
        { name: 'monthlyDownloads', type: 'number' },
        { name: 'latestVersion', type: 'text' },
        { name: 'unpackedSize', type: 'number' },
        { name: 'lastPublish', type: 'date' },
        { name: 'dependencyCount', type: 'number' },
      ],
    },
    { name: 'healthScore', type: 'number', min: 0, max: 100, index: true },
    // Taxonomy
    { name: 'category', type: 'relationship', relationTo: 'categories', index: true, admin: { position: 'sidebar' } },
    createTagField({ relationTo: 'tags', label: 'Tags' }),
    // AI enrichment (written in phase 2)
    {
      name: 'ai',
      type: 'group',
      admin: {
        description:
          'Generated from the README by Claude. Editing a field here locks it (see Locks), so enrichment never overwrites it; untick the lock to hand it back.',
      },
      fields: [
        { name: 'tagline', type: 'text', maxLength: 120 },
        { name: 'summary', type: 'textarea', maxLength: 600 },
        { name: 'features', type: 'text', hasMany: true },
        { name: 'useCases', type: 'text', hasMany: true },
        { name: 'confidence', type: 'number', min: 0, max: 1, admin: { readOnly: true } },
        { name: 'model', type: 'text', admin: { readOnly: true } },
        { name: 'enrichedAt', type: 'date', admin: { readOnly: true } },
        { name: 'enrichedHash', type: 'text', admin: { readOnly: true } },
        // Fingerprint of prompt version + model + admin instructions + category tree (src/enrich/prompt.ts).
        { name: 'promptHash', type: 'text', access: { read: adminOnly }, admin: { readOnly: true } },
        // Last failed attempt (refusal, max_tokens, invalid output). Cleared by the next success. Admin-only.
        { name: 'failure', type: 'text', access: { read: adminOnly }, admin: { readOnly: true } },
        { name: 'failedAt', type: 'date', access: { read: adminOnly }, admin: { readOnly: true } },
        { name: 'failedKey', type: 'text', access: { read: adminOnly }, admin: { hidden: true } },
      ],
    },
    {
      name: 'locks',
      type: 'group',
      admin: { position: 'sidebar' },
      fields: aiLockable.map((name) => ({ name, type: 'checkbox' as const, defaultValue: false })),
    },
    // Maintainer
    { name: 'maintainers', type: 'relationship', relationTo: 'maintainers', hasMany: true },
    {
      name: 'customTagline',
      type: 'text',
      maxLength: 120,
      // Every write path is normalised here (NFKC, invisible characters stripped, trimmed, clamped; empty -> null).
      hooks: { beforeValidate: [({ value }) => (value === undefined ? value : normalizeTagline(value))] },
    },
    { name: 'logo', type: 'upload', relationTo: 'media' },
    // Visibility
    {
      name: 'visibility',
      type: 'select',
      required: true,
      defaultValue: 'listed',
      index: true,
      options: ['listed', 'hidden'],
      admin: { position: 'sidebar' },
    },
    {
      name: 'syncTrashReason',
      type: 'select',
      options: ['repository-gone', 'package-removed'],
      access: { read: adminOnly, create: adminOnly, update: adminOnly },
      admin: {
        position: 'sidebar',
        readOnly: true,
        description:
          'Set when sync moved this plugin to Trash. Sync restores it when the package reappears; plugins an admin trashed stay trashed (use Visibility to hide a plugin).',
      },
    },
  ],
}
