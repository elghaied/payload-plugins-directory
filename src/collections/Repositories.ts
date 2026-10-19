import type { CollectionConfig } from 'payload'
import { anyone, isAdmin } from '@/access'
import { DESCRIPTION_MAX_CHARS } from '@/sync/limits'

export const Repositories: CollectionConfig = {
  slug: 'repositories',
  admin: { useAsTitle: 'fullName', group: 'Directory', defaultColumns: ['fullName', 'stars', 'pushedAt', 'isArchived'] },
  access: { read: anyone, create: isAdmin, update: isAdmin, delete: isAdmin },
  versions: false,
  authorship: false, // system-synced; no per-user attribution to track (or leak)
  fields: [
    { name: 'fullName', type: 'text', required: true, unique: true, index: true },
    { name: 'githubId', type: 'number', unique: true, index: true },
    { name: 'owner', type: 'text', required: true, index: true },
    { name: 'ownerAvatar', type: 'text' },
    { name: 'url', type: 'text', required: true },
    { name: 'description', type: 'textarea', maxLength: DESCRIPTION_MAX_CHARS },
    { name: 'stars', type: 'number', defaultValue: 0, index: true },
    { name: 'forks', type: 'number', defaultValue: 0 },
    { name: 'openIssues', type: 'number', defaultValue: 0 },
    { name: 'license', type: 'text' },
    { name: 'isArchived', type: 'checkbox', defaultValue: false },
    { name: 'pushedAt', type: 'date' },
    { name: 'githubCreatedAt', type: 'date', admin: { description: 'GitHub repository creation date.' } },
    { name: 'defaultBranch', type: 'text' },
    { name: 'topics', type: 'text', hasMany: true },
    { name: 'isMonorepo', type: 'checkbox', defaultValue: false },
    { name: 'lastSyncedAt', type: 'date' },
    { name: 'missedDiscoveries', type: 'number', defaultValue: 0 },
  ],
}
