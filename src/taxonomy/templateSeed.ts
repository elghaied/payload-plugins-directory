import type { Payload, PayloadRequest } from 'payload'
import { STARTER_TEMPLATE_CATEGORIES } from './templateStarter'
import { flattenStarter } from './tree'

/**
 * Creates the starter template categories that do not exist yet (matched by slug). Never updates or deletes:
 * admins own the tree after the first seed.
 */
export async function seedTemplateCategories(payload: Payload, opts: { req?: PayloadRequest } = {}): Promise<{ created: string[] }> {
  // Fresh context per write; no search sync is involved (template categories are not indexed).
  const base = () => ({ overrideAccess: true as const, depth: 0, context: { skipRevalidate: true }, ...(opts.req ? { req: opts.req } : {}) })
  const created: string[] = []
  const ids = new Map<string, number>()
  for (const c of flattenStarter(STARTER_TEMPLATE_CATEGORIES)) {
    const found = await payload.find({ collection: 'template-categories', ...base(), limit: 1, where: { slug: { equals: c.slug } } })
    if (found.docs[0]) {
      ids.set(c.slug, found.docs[0].id)
      continue
    }
    const parent = c.parentSlug ? (ids.get(c.parentSlug) ?? null) : null
    const doc = await payload.create({
      collection: 'template-categories',
      ...base(),
      data: { title: c.title, slug: c.slug, intro: c.intro, icon: c.icon, parent },
    })
    ids.set(c.slug, doc.id)
    created.push(c.slug)
  }
  return { created }
}
