import type { Payload, Where } from 'payload'

export type SyncTrashReason = 'repository-gone' | 'package-removed'

/**
 * Moves matching, not-yet-trashed plugins to Trash and records why, so sync may restore them later.
 * Plugins an admin trashed have no reason and are never restored by sync.
 */
export async function trashPlugins(payload: Payload, where: Where, reason: SyncTrashReason, now: Date): Promise<string[]> {
  const res = await payload.update({
    collection: 'plugins',
    overrideAccess: true,
    depth: 0,
    context: { syncTrash: true, skipRevalidate: true },
    where: { and: [where, { deletedAt: { exists: false } }] },
    data: { deletedAt: now.toISOString(), syncTrashReason: reason },
  })
  if (res.errors.length) throw new Error(`Trashing plugins failed: ${res.errors.map((e) => e.message).join('; ')}`)
  return res.docs.map((d) => d.slug).sort()
}
