import type { Payload } from 'payload'
import { relationId } from '@/lib/relationId'

const DAY_MS = 24 * 60 * 60 * 1000
const BATCH = 200

/** Media rows created by maintainer uploads; the only ones the sweep may delete. Admin uploads are never touched. */
export const SWEEPABLE_MEDIA_ORIGINS = ['maintainer', 'template-screenshot'] as const

const ids = (values: unknown[]): number[] => values.map(relationId).filter((id): id is number => typeof id === 'number')

/**
 * Every media id referenced by a document: `plugins.logo` ∪ `templates.screenshots`, trashed documents included (a
 * restore must find its files). These are the only relations to `media`; any new one must be added here.
 */
export async function referencedMediaIds(payload: Payload): Promise<number[]> {
  const [plugins, templates] = await Promise.all([
    payload.find({
      collection: 'plugins', overrideAccess: true, depth: 0, trash: true, pagination: false, limit: 0,
      where: { logo: { exists: true } }, select: { logo: true },
    }),
    payload.find({
      collection: 'templates', overrideAccess: true, depth: 0, trash: true, pagination: false, limit: 0, select: { screenshots: true },
    }),
  ])
  return [...new Set([...ids(plugins.docs.map((p) => p.logo)), ...ids(templates.docs.flatMap((t) => t.screenshots ?? []))])]
}

/** True when a plugin logo or a template screenshot (trashed documents included) points at the media row. */
export async function isMediaReferenced(payload: Payload, mediaId: number): Promise<boolean> {
  const [logos, screenshots] = await Promise.all([
    payload.count({ collection: 'plugins', overrideAccess: true, trash: true, where: { logo: { equals: mediaId } } }),
    payload.count({ collection: 'templates', overrideAccess: true, trash: true, where: { screenshots: { in: [mediaId] } } }),
  ])
  return logos.totalDocs > 0 || screenshots.totalDocs > 0
}

/** Deletes a media row nothing references. Never throws: a failed cleanup is logged and must not mask the real outcome. */
export async function deleteMediaIfUnreferenced(payload: Payload, mediaId: number, scope: string): Promise<void> {
  try {
    if (!(await isMediaReferenced(payload, mediaId))) await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })
  } catch (err) {
    payload.logger.error({ err, mediaId }, `${scope}: could not delete unreferenced media`)
  }
}

/** Deletes a media row created by a write that then failed. Never throws: the sweep removes what this misses. */
export async function deleteMediaQuietly(payload: Payload, mediaId: number, scope: string): Promise<void> {
  try {
    await payload.delete({ collection: 'media', id: mediaId, overrideAccess: true })
  } catch (err) {
    payload.logger.error({ err, mediaId }, `${scope}: could not delete media after a failed save`)
  }
}

/**
 * Deletes maintainer-uploaded media (logos: `origin = 'maintainer'`, template screenshots: `'template-screenshot'`)
 * that nothing references (see `referencedMediaIds`) and that is older than a day: leftovers of crashed or racing
 * uploads. Admin uploads are never touched.
 * Runs at the tail of the daily snapshot job. Referenced rows are excluded in the query, so a page of live media can
 * never hide an orphan; one batch per run, and a larger backlog drains over the following days.
 *
 * The worker deletes through Payload, which unlinks the file (and its variants) under ITS `staticDir`: the worker must
 * mount the same media volume as web (docker/compose.yml), or the rows go but the files stay.
 */
export async function sweepOrphanMedia(payload: Payload, now: Date): Promise<number> {
  const referenced = await referencedMediaIds(payload)
  const old = await payload.find({
    collection: 'media', overrideAccess: true, depth: 0, limit: BATCH, sort: 'createdAt', pagination: false,
    where: {
      and: [
        { origin: { in: [...SWEEPABLE_MEDIA_ORIGINS] } },
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
