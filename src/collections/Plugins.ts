import type { CollectionConfig, Where } from 'payload'
import { createTagField } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'

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
  access: {
    read: ({ req }) => (isAdminUser(req.user) ? true : listedPluginsWhere),
    create: isAdmin,
    update: isAdmin, // phase 4 adds claimed-maintainer updates of customTagline/logo
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [
      // A trash/restore that does not come from the sync trash helper is an admin decision: drop sync's
      // reason so sync never treats an admin-trashed plugin as its own (and restores it).
      ({ data, originalDoc, context }) => {
        if (context.syncTrash || !('deletedAt' in data)) return data
        if (Boolean(data.deletedAt) !== Boolean(originalDoc?.deletedAt)) data.syncTrashReason = null
        return data
      },
    ],
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
    { name: 'description', type: 'textarea' },
    { name: 'readme', type: 'textarea' },
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
      admin: { description: 'Generated from the README. Lock a field to stop it being overwritten.' },
      fields: [
        { name: 'tagline', type: 'text', maxLength: 120 },
        { name: 'summary', type: 'textarea', maxLength: 600 },
        { name: 'features', type: 'text', hasMany: true },
        { name: 'useCases', type: 'text', hasMany: true },
        { name: 'confidence', type: 'number', min: 0, max: 1 },
        { name: 'model', type: 'text' },
        { name: 'enrichedAt', type: 'date' },
        { name: 'enrichedHash', type: 'text' },
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
    { name: 'customTagline', type: 'text', maxLength: 120 },
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
