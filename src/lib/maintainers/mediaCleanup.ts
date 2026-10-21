import type { Payload } from 'payload'
import { relationId } from '@/lib/relationId'

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 200

/**
 * Deletes maintainer-uploaded logos (`origin = 'maintainer'`) that no plugin references (trashed plugins count as
 * references) and that are older than a day: leftovers of crashed or racing uploads. Admin uploads are never touched.
 * `plugins.logo` is the only relation to `media`; any new relation to media must be added to `referencedLogoIds`.
 * Runs at the tail of the daily snapshot job. Referenced rows are excluded in the query, so a page of live logos can
 * never hide an orphan; one batch per run, and a larger backlog drains over the following days.
 *
 * The worker deletes through Payload, which unlinks the file under ITS `staticDir`: the worker must mount the same
 * media volume as web (docker/compose.yml), or the rows go but the files stay.
 */
export async function referencedLogoIds(payload: Payload): Promise<number[]> {
  const used = await payload.find({
    collection: 'plugins', overrideAccess: true, depth: 0, trash: true, pagination: false, limit: 0,
    where: { logo: { exists: true } }, select: { logo: true },
  })
  return [...new Set(used.docs.map((p) => relationId(p.logo)).filter((id): id is number => typeof id === 'number'))]
}

export async function sweepOrphanMedia(payload: Payload, now: Date): Promise<number> {
  const referenced = await referencedLogoIds(payload)
  const old = await payload.find({
    collection: 'media', overrideAccess: true, depth: 0, limit: BATCH, sort: 'createdAt', pagination: false,
    where: {
      and: [
        { origin: { equals: 'maintainer' } },
        { createdAt: { less_than: new Date(now.getTime() - DAY_MS).toISOString() } },
        ...(referenced.length ? [{ id: { not_in: referenced } }] : []),
      ],
    },
  })
  let deleted = 0
  for (const { id } of old.docs) {
    try {
      await payload.delete({ collection: 'media', id, overrideAccess: true })
      deleted++
    } catch (err) {
      payload.logger.error({ err, mediaId: id }, 'media sweep: delete failed')
    }
  }
  return deleted
}
