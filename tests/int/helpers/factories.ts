import type { Payload } from 'payload'

export { createPlugin, createRepo } from './directory'

/** Soft-delete: `payload.delete` hard-deletes in 4.0.0-beta.2, so trash through `deletedAt` (as the admin UI does). */
export async function trashPlugin(payload: Payload, id: number) {
  await payload.update({
    collection: 'plugins',
    id,
    overrideAccess: true,
    context: { skipRevalidate: true },
    data: { deletedAt: new Date().toISOString() },
  })
}

export async function searchDocsFor(payload: Payload, collection: 'plugins' | 'categories' | 'tags', id: number) {
  const res = await payload.find({
    collection: 'search',
    overrideAccess: true,
    depth: 0,
    pagination: false,
    limit: 0,
    where: { and: [{ 'doc.relationTo': { equals: collection } }, { 'doc.value': { equals: id } }] },
  })
  return res.docs
}
