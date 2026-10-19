import { strictObject } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { applyAliasTagsToAll, seedTaxonomy, unmappedTopics } from '@/taxonomy/seed'

/** Re-runnable seed for local databases: adds missing starter items, applies alias tags, lists unmapped topics. */
export const seedTaxonomyCommand = defineCLICommand({
  description: 'Create missing starter categories/tags/presets, apply alias tags to all plugins, list unmapped GitHub topics.',
  input: strictObject({}),
  handler: async ({ getPayload }) => {
    const payload = await getPayload()
    const seeded = await seedTaxonomy(payload)
    const aliases = await applyAliasTagsToAll(payload)
    payload.logger.info({ ...seeded, aliasTagsAddedTo: aliases.updated.length }, 'Taxonomy seeded')
    const topics = await unmappedTopics(payload)
    if (topics.length) payload.logger.info({ topics }, 'Most common GitHub topics without a tag alias (add aliases in the admin)')
  },
})
