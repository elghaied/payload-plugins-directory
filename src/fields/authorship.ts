import { createCreatedByField, createUpdatedByField } from 'payload'
import { adminOnly } from '@/access'

// v4 adds `createdBy` / `updatedBy` (relationships to the auth collections) to every collection and
// global by default, readable by anyone who can read the document. Declaring them explicitly keeps
// Payload's stamping hooks and only adds field-level read access, so the public API never reveals
// which admin edited a document. (Payload backfills `relationTo` during sanitization.)
const adminOnlyRead = { access: { read: adminOnly } }

export const adminOnlyCreatedBy = () => createCreatedByField({ overrides: adminOnlyRead })
export const adminOnlyUpdatedBy = () => createUpdatedByField({ overrides: adminOnlyRead })
export const adminOnlyAuthorship = () => [adminOnlyCreatedBy(), adminOnlyUpdatedBy()]
