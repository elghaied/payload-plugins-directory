import type { Payload } from 'payload'
import { effectiveStack } from '@/lib/templates/stack'
import type { Template } from '@/payload-types'
import { leafCategories, toCategoryNodes, type CategoryNode } from '@/taxonomy/tree'
import { loadSettings, loadTagRefs, type EnrichContext } from '../context'
import { buildOutputSchema } from '../schema'
import { buildTemplateSystemPrompt, templatePromptFingerprint, type TemplateInput } from './prompt'

/** The template category tree, paths requested explicitly (toCategoryNodes throws when a child has none). */
export async function loadTemplateCategoryNodes(payload: Payload): Promise<CategoryNode[]> {
  const res = await payload.find({
    collection: 'template-categories',
    overrideAccess: true,
    depth: 0,
    limit: 0,
    pagination: false,
    context: { computeHierarchyPaths: true },
  })
  return toCategoryNodes(res.docs)
}

/** Same shape as loadEnrichContext; categories come from `template-categories`, prompt and fingerprint are the template ones. */
export async function loadTemplateEnrichContext(payload: Payload): Promise<EnrichContext> {
  const [settings, nodes, tags] = await Promise.all([loadSettings(payload), loadTemplateCategoryNodes(payload), loadTagRefs(payload)])
  const leaves = leafCategories(nodes)
  return {
    settings,
    nodes,
    leaves,
    tags,
    system: buildTemplateSystemPrompt({ nodes, leaves, tags }, settings),
    // No leaves: nothing can be classified and runEnrichTemplate skips ('no-categories'); buildOutputSchema would throw.
    schema: leaves.length ? buildOutputSchema(leaves.map((l) => l.slug).sort(), tags.map((t) => t.slug)) : {},
    fingerprint: templatePromptFingerprint({ nodes, leaves }, settings),
  }
}

/** Non-trashed template with its repository (topics) and category populated, or null. */
export async function findActiveTemplate(payload: Payload, id: number): Promise<Template | null> {
  const res = await payload.find({ collection: 'templates', overrideAccess: true, depth: 1, limit: 1, where: { id: { equals: id } } })
  return res.docs[0] ?? null
}

/** Discovery topics say nothing about one template. */
const GENERIC_TOPICS = new Set(['payload-template', 'payload-plugin'])

export function toTemplateInput(doc: Template): TemplateInput {
  const repo = typeof doc.repository === 'object' && doc.repository ? doc.repository : null
  return {
    name: doc.name,
    description: doc.description ?? null,
    topics: (repo?.topics ?? []).filter((t) => !GENERIC_TOPICS.has(t)),
    stack: effectiveStack(doc),
    payloadVersionRange: doc.payloadVersionRange ?? null,
    dependencyNames: doc.dependencyNames ?? [],
    readme: doc.readme ?? null,
  }
}
