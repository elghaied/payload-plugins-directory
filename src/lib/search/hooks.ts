import type { CollectionAfterChangeHook, PayloadRequest } from 'payload'
import { isPubliclyListed, type SearchableCollection } from './searchDoc'
import { removeSearchDocs } from './sync'

/**
 * Never fail the source write because of the search index. Public reads re-check access on the plugin
 * itself, so a stale index entry cannot expose a hidden plugin; `pnpm payload reindex-search` repairs it.
 */
export async function guarded(req: PayloadRequest, what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    req.payload.logger.error({ err, msg: `search: ${what} failed` })
  }
}

/**
 * plugin-search remembers `collection:id` in `req.context.syncedDocsSet` and skips a document already in the set. Payload 4
 * uses the caller's own context object, so a context (or `req`) reused across writes would freeze the index after the first
 * change. Forgetting the key before plugin-search's hook runs makes every write sync; the set only existed to stop
 * nested-docs style recursion, which this app does not use.
 */
export const forgetSyncedDoc =
  (collection: SearchableCollection): CollectionAfterChangeHook =>
  ({ doc, req }) => {
    ;(req.context as { syncedDocsSet?: Set<string> } | undefined)?.syncedDocsSet?.delete(`${collection}:${String(doc.id)}`)
    return doc
  }

/** Runs before plugin-search's own afterChange hook (collection hooks first, plugin hooks appended). */
export const removeUnlistedPluginFromSearch: CollectionAfterChangeHook = async ({ doc, req }) => {
  if (!isPubliclyListed(doc)) {
    await guarded(req, `removing plugin ${doc.id} from the index`, () => removeSearchDocs(req.payload, 'plugins', doc.id, req))
  }
  return doc
}
