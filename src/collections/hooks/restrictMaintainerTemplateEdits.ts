import type { CollectionBeforeOperationHook } from 'payload'
import { Forbidden } from 'payload'
import { isMaintainerWrite } from '@/collections/hooks/restrictMaintainerPluginEdits'

export const MAINTAINER_EDITABLE_TEMPLATE_FIELDS = ['customTagline', 'demoUrl', 'videoUrl', 'stackOverride', 'screenshots'] as const
const ALLOWED = new Set<string>(MAINTAINER_EDITABLE_TEMPLATE_FIELDS)

/** Operations a maintainer may run on `templates`; everything else (create, delete, restoreVersion, ...) is denied. */
const MAINTAINER_OPERATIONS = new Set<string>(['read', 'count', 'readDistinct', 'update'])

/** `req.context` key set only by the screenshot server action after it checked the media. REST and GraphQL callers cannot set `req.context`. */
export const MAINTAINER_TEMPLATE_CONTEXT_KEY = 'maintainerTemplateEdit'

/**
 * A maintainer may update only the owner allow-list. Access control decides WHICH templates; this hook decides WHICH
 * FIELDS, and rejects the whole request (never silently drops keys). `screenshots` additionally needs the server-action
 * context key, so a client can never point it at an arbitrary media id.
 */
export const restrictMaintainerTemplateEdits: CollectionBeforeOperationHook = ({ args, operation, overrideAccess, req }) => {
  if (overrideAccess || !isMaintainerWrite(req)) return args
  const op = String(operation)
  if (!MAINTAINER_OPERATIONS.has(op)) throw new Forbidden(req.t)
  if (op !== 'update') return args
  const data = (args as { data?: Record<string, unknown> }).data ?? {}
  const keys = Object.keys(data)
  if (keys.some((key) => !ALLOWED.has(key))) throw new Forbidden(req.t)
  if (keys.includes('screenshots') && (req.context as Record<string, unknown> | undefined)?.[MAINTAINER_TEMPLATE_CONTEXT_KEY] !== true) throw new Forbidden(req.t)
  return args
}
