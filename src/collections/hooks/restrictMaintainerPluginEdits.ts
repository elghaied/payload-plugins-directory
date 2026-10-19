import type { CollectionBeforeChangeHook, CollectionBeforeOperationHook } from 'payload'
import { Forbidden } from 'payload'
import { relationId } from '@/lib/relationId'
import { normalizeTagline } from '@/lib/maintainers/branding'

export const MAINTAINER_EDITABLE_PLUGIN_FIELDS = ['customTagline', 'logo'] as const
const ALLOWED = new Set<string>(MAINTAINER_EDITABLE_PLUGIN_FIELDS)

const isMaintainerWrite = (req: { user?: unknown }) => (req.user as { collection?: string } | null | undefined)?.collection === 'maintainers'

/**
 * Spec §9.1: a maintainer may update only `customTagline` and `logo`. Access control decides WHICH plugins;
 * this hook decides WHICH FIELDS, and rejects the whole request (rather than silently dropping keys) so a
 * client can never believe an edit to another field succeeded. Covers update-by-id and bulk update, and every
 * transport (Local API, REST, GraphQL), because they all run this operation hook.
 * `logo` is further restricted to the branding server action, which sets `context.brandingWrite` after it has
 * checked the media. REST/GraphQL callers cannot set `req.context`, so they cannot point `logo` at an arbitrary media id.
 */
export const restrictMaintainerPluginEdits: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (!String(operation).startsWith('update')) return args
  if (overrideAccess || !isMaintainerWrite(req)) return args
  const data = (args as { data?: Record<string, unknown> }).data ?? {}
  const keys = Object.keys(data)
  if (keys.some((key) => !ALLOWED.has(key))) throw new Forbidden(req.t)
  if (keys.includes('logo') && (req.context as { brandingWrite?: boolean } | undefined)?.brandingWrite !== true) throw new Forbidden(req.t)
  return args
}

/**
 * A maintainer save that leaves tagline and logo as they were is a no-op: it must not queue a revalidate job.
 * Sets the same `skipRevalidate` flag system writers use, so the existing revalidate hook stays the only path.
 * Runs after the `customTagline` field normalisation (collection beforeChange follows field beforeValidate).
 */
export const skipUnchangedBrandingRevalidate: CollectionBeforeChangeHook = ({ data, originalDoc, operation, req, context }) => {
  if (operation !== 'update' || !originalDoc || !isMaintainerWrite(req)) return data
  const taglineChanged = 'customTagline' in data && normalizeTagline(data.customTagline) !== normalizeTagline(originalDoc.customTagline)
  const logoChanged = 'logo' in data && (relationId(data.logo) ?? null) !== (relationId(originalDoc.logo) ?? null)
  if (!taglineChanged && !logoChanged) (context as { skipRevalidate?: boolean }).skipRevalidate = true
  return data
}
