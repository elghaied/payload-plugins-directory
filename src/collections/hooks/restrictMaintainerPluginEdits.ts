import type { CollectionBeforeOperationHook } from 'payload'
import { Forbidden } from 'payload'
import { relationId } from '@/lib/relationId'

export const MAINTAINER_EDITABLE_PLUGIN_FIELDS = ['customTagline', 'logo'] as const
const ALLOWED = new Set<string>(MAINTAINER_EDITABLE_PLUGIN_FIELDS)

/** Operations a maintainer may run on `plugins`; everything else (create, delete, restoreVersion, autosave, ...) is denied. */
const MAINTAINER_OPERATIONS = new Set<string>(['read', 'count', 'readDistinct', 'update'])

/** `req.context` key set only by the branding server action (ruling F9). REST and GraphQL callers cannot set `req.context`. */
export const MAINTAINER_BRANDING_CONTEXT_KEY = 'maintainerBranding'

export const isMaintainerWrite = (req: { user?: unknown }) => (req.user as { collection?: string } | null | undefined)?.collection === 'maintainers'

/**
 * Spec §9.1: a maintainer may update only `customTagline` and `logo`. Access control decides WHICH plugins;
 * this hook decides WHICH FIELDS, and rejects the whole request (rather than silently dropping keys) so a
 * client can never believe an edit to another field succeeded. Covers update-by-id and bulk update, and every
 * transport (Local API, REST, GraphQL), because they all run this operation hook. Maintainers may run only
 * `read`-type operations and `update`; any other operation is denied.
 * `logo` is further restricted to the branding server action, which sets `context.maintainerBranding` after it has
 * checked the media, so a client cannot point `logo` at an arbitrary media id.
 */
export const restrictMaintainerPluginEdits: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (overrideAccess || !isMaintainerWrite(req)) return args
  const op = String(operation)
  if (!MAINTAINER_OPERATIONS.has(op)) throw new Forbidden(req.t)
  if (op !== 'update') return args
  const data = (args as { data?: Record<string, unknown> }).data ?? {}
  const keys = Object.keys(data)
  if (keys.some((key) => !ALLOWED.has(key))) throw new Forbidden(req.t)
  if (keys.includes('logo') && (req.context as Record<string, unknown> | undefined)?.[MAINTAINER_BRANDING_CONTEXT_KEY] !== true) throw new Forbidden(req.t)
  return args
}

/**
 * True when a maintainer's save left tagline and logo as they were. Decided per document from the saved
 * result, so it is safe in bulk updates and for a caller-reused context (nothing is written to `req.context`).
 */
export function isUnchangedMaintainerBranding(
  req: { user?: unknown },
  previousDoc: { customTagline?: unknown; logo?: unknown } | undefined,
  doc: { customTagline?: unknown; logo?: unknown },
): boolean {
  if (!previousDoc || !isMaintainerWrite(req)) return false
  return (
    (previousDoc.customTagline ?? null) === (doc.customTagline ?? null) &&
    (relationId(previousDoc.logo) ?? null) === (relationId(doc.logo) ?? null)
  )
}
