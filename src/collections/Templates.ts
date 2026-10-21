import type { CollectionBeforeChangeHook, CollectionConfig, Where } from 'payload'
import { createTagField } from 'payload'
import { adminOnly, isAdmin, isAdminUser } from '@/access'
import { restrictMaintainerTemplateEdits } from '@/collections/hooks/restrictMaintainerTemplateEdits'
import { revalidateTemplateChange, revalidateTemplateDelete } from '@/collections/hooks/revalidateTemplate'
import { lockAdminEditedAiFields } from '@/enrich/locks'
import { canonicalVideoUrl, parseDemoUrl, parseVideoUrl } from '@/lib/templates/links'
import { STACKS } from '@/lib/templates/stack'
import { normalizeTagline } from '@/lib/maintainers/tagline'
import { DESCRIPTION_MAX_CHARS, README_MAX_CHARS } from '@/sync/limits'
import { README_HTML_MAX_CHARS } from '@/lib/directory/readmeLimits'

export const listedTemplatesWhere: Where = {
  and: [{ visibility: { equals: 'listed' } }, { deletedAt: { exists: false } }],
}

const aiLockable = ['category', 'tags', 'tagline', 'summary', 'features', 'useCases'] as const

const emptyToNull = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? null : value)

export const Templates: CollectionConfig = {
  slug: 'templates',
  admin: {
    useAsTitle: 'name',
    group: 'Directory',
    defaultColumns: ['name', 'slug', 'category', 'isOfficial', 'visibility'],
  },
  versions: false,
  authorship: false, // system-synced; no per-user attribution to track (or leak)
  trash: true,
  access: {
    read: ({ req }) => (isAdminUser(req.user) ? true : listedTemplatesWhere),
    create: isAdmin,
    // Maintainers: only listed templates they maintain. Which fields is enforced by restrictMaintainerTemplateEdits.
    update: ({ req }) => {
      if (isAdminUser(req.user)) return true
      if (req.user?.collection === 'maintainers') {
        return { and: [listedTemplatesWhere, { maintainers: { in: [req.user.id] } }] }
      }
      return false
    },
    delete: isAdmin,
  },
  hooks: {
    beforeOperation: [restrictMaintainerTemplateEdits],
    beforeChange: [
      // A trash/restore that does not come from the sync trash helper is an admin decision: drop sync's
      // reason so sync never treats an admin-trashed template as its own (and restores it).
      ({ data, originalDoc, context }) => {
        if (context.syncTrash || !('deletedAt' in data)) return data
        if (Boolean(data.deletedAt) !== Boolean(originalDoc?.deletedAt)) data.syncTrashReason = null
        return data
      },
      // Reads only category, _h_tags, ai.* and locks, which templates share with plugins.
      lockAdminEditedAiFields as unknown as CollectionBeforeChangeHook,
    ],
    afterChange: [revalidateTemplateChange],
    afterDelete: [revalidateTemplateDelete],
  },
  fields: [
    // Identity
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'name', type: 'text', required: true },
    { name: 'repository', type: 'relationship', relationTo: 'repositories', required: true, index: true },
    { name: 'path', type: 'text', admin: { description: 'Subdirectory within the repository; empty for a repo-root template.' } },
    { name: 'url', type: 'text', required: true },
    { name: 'isOfficial', type: 'checkbox', defaultValue: false, index: true },
    { name: 'source', type: 'select', required: true, defaultValue: 'submission', options: ['official', 'submission', 'converted'] },
    { name: 'firstSeenAt', type: 'date' },
    // Source content
    { name: 'description', type: 'textarea', maxLength: DESCRIPTION_MAX_CHARS },
    { name: 'readme', type: 'textarea', maxLength: README_MAX_CHARS },
    { name: 'readmeTruncated', type: 'checkbox', defaultValue: false, admin: { readOnly: true, description: 'Set by sync when the README was cut at the storage limit.' } },
    // Rendered at sync time in the worker (sanitized HTML, null = plain text). Never public; read server-side only.
    {
      name: 'readmeHtml',
      type: 'textarea',
      maxLength: README_HTML_MAX_CHARS,
      access: { read: adminOnly, create: () => false, update: () => false },
      admin: { readOnly: true, hidden: true },
    },
    {
      name: 'readmeRenderVersion',
      type: 'text',
      access: { read: adminOnly, create: () => false, update: () => false },
      admin: { readOnly: true, hidden: true },
    },
    // First <img> of the rendered README (system-written, host re-checked on read).
    {
      name: 'fallbackImageUrl',
      type: 'text',
      access: { read: adminOnly, create: () => false, update: () => false },
      admin: { readOnly: true, hidden: true },
    },
    { name: 'contentHash', type: 'text', admin: { readOnly: true } },
    { name: 'dependencyNames', type: 'text', hasMany: true, admin: { readOnly: true, description: 'package.json dependency names (written by sync).' } },
    // Compatibility
    { name: 'payloadVersionRange', type: 'text' },
    { name: 'payloadMajors', type: 'select', hasMany: true, index: true, options: ['1', '2', '3', '4', 'unknown'] },
    { name: 'stackDetected', type: 'select', options: [...STACKS], admin: { readOnly: true, description: 'Detected at sync time from package.json.' } },
    { name: 'stackOverride', type: 'select', options: [...STACKS], admin: { description: 'Wins over the detected stack.' } },
    // Repo facts
    { name: 'isTemplateRepo', type: 'checkbox', defaultValue: false },
    { name: 'lastUpdatedAt', type: 'date' },
    { name: 'license', type: 'text' },
    // Taxonomy
    { name: 'category', type: 'relationship', relationTo: 'template-categories', index: true, admin: { position: 'sidebar' } },
    createTagField({ relationTo: 'tags', label: 'Tags' }),
    // AI enrichment
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
        { name: 'promptHash', type: 'text', access: { read: adminOnly }, admin: { readOnly: true } },
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
    // Owner
    { name: 'maintainers', type: 'relationship', relationTo: 'maintainers', hasMany: true },
    {
      name: 'customTagline',
      type: 'text',
      maxLength: 120,
      hooks: { beforeValidate: [({ value }) => (value === undefined ? value : normalizeTagline(value))] },
    },
    // Visuals
    { name: 'screenshots', type: 'upload', relationTo: 'media', hasMany: true, maxRows: 8 },
    {
      name: 'demoUrl',
      type: 'text',
      maxLength: 500,
      hooks: {
        beforeValidate: [
          ({ value }) => {
            const empty = emptyToNull(value)
            if (empty === undefined || empty === null) return empty
            return parseDemoUrl(empty) ?? empty
          },
        ],
      },
      validate: (value: unknown) => {
        if (value === undefined || value === null || value === '') return true
        return parseDemoUrl(value) !== null || 'Enter a public https:// URL (no credentials, localhost or IP address).'
      },
    },
    {
      name: 'videoUrl',
      type: 'text',
      maxLength: 500,
      hooks: {
        beforeValidate: [
          ({ value }) => {
            const empty = emptyToNull(value)
            if (empty === undefined || empty === null) return empty
            const ref = parseVideoUrl(empty)
            return ref ? canonicalVideoUrl(ref) : empty
          },
        ],
      },
      validate: (value: unknown) => {
        if (value === undefined || value === null || value === '') return true
        return parseVideoUrl(value) !== null || 'Enter a YouTube, Vimeo or Loom video URL.'
      },
    },
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
          'Set when sync moved this template to Trash. Sync restores it when the template reappears; templates an admin trashed stay trashed (use Visibility to hide a template).',
      },
    },
  ],
}
