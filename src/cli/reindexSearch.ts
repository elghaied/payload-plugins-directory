import type { Payload } from 'payload'
import { strictObject, z } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { reindexSearch, type ReindexOptions, type ReindexResult } from '@/lib/search/reindex'

/** The command body, separate from Payload's CLI wiring so tests can call it. Throws (non-zero exit) when documents failed. */
export async function runReindexSearch(payload: Payload, args: { ifIncomplete: boolean }, sync?: ReindexOptions['sync']): Promise<ReindexResult> {
  const result = await reindexSearch(payload, { ifIncomplete: args.ifIncomplete, sync })
  payload.logger.info(result, 'Search reindex complete')
  if (result.failed > 0) throw new Error(`Search reindex: ${result.failed} document(s) failed; see the log above and re-run.`)
  return result
}

export const reindexSearchCommand = defineCLICommand({
  description: 'Rebuild the search index from plugins, categories and tags. --if-incomplete only runs when the index has fewer rows than there are sources.',
  input: strictObject({ ifIncomplete: z._default(z.boolean(), false) }),
  handler: async ({ args, getPayload }) => ({ result: await runReindexSearch(await getPayload(), args) }),
})
