import type { Payload } from 'payload'
import { relationId } from '@/lib/relationId'

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 200

/**
 * Deletes media not referenced by any plugin (trashed ones count as references) and older than a day: leftovers
 * of crashed or racing logo uploads. `plugins.logo` is the only relation to `media`. Runs at the tail of the daily
 * snapshot job. One batch per run; a larger backlog drains over the following days.
 */
export async function sweepOrphanMedia(payload: Payload, now: Date): Promise<number> {
  const old = await payload.find({
    collection: 'media', overrideAccess: true, depth: 0, limit: BATCH, sort: 'createdAt',
    where: { createdAt: { less_than: new Date(now.getTime() - DAY_MS).toISOString() } },
  })
  if (!old.docs.length) return 0
  const ids = old.docs.map((m) => m.id)
  const used = await payload.find({
    collection: 'plugins', overrideAccess: true, depth: 0, trash: true, pagination: false, limit: 0,
    where: { logo: { in: ids } }, select: { logo: true },
  })
  const referenced = new Set(used.docs.map((p) => relationId(p.logo)))
  let deleted = 0
  for (const id of ids) {
    if (referenced.has(id)) continue
    try {
      await payload.delete({ collection: 'media', id, overrideAccess: true })
      deleted++
    } catch (err) {
      payload.logger.error({ err, mediaId: id }, 'media sweep: delete failed')
    }
  }
  return deleted
}
