import { readFile } from 'fs/promises'
import type { Payload } from 'payload'
import { strictObject, z } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { QUEUES } from '@/sync/queues'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'

/** Ids blocklisted in the legacy data/blocklist.json (removed in Task 14); always applied so a plain `seed --file` never lists them. */
export const LEGACY_BLOCKLIST_IDS = ['979457999-root']

export async function seedDirectory(payload: Payload, input: ReturnType<typeof mapLegacy>) {
  const counts = { repositoriesCreated: 0, repositoriesUpdated: 0, pluginsCreated: 0, pluginsUpdated: 0 }
  const repoIds = new Map<string, number>()

  for (const repo of input.repositories) {
    const existing = await payload.find({
      collection: 'repositories',
      overrideAccess: true,
      where: { fullName: { equals: repo.fullName } },
      limit: 1,
    })
    if (existing.docs[0]) {
      // githubId is unique and may be absent from the input; never null out a stored value.
      const { githubId, ...rest } = repo
      await payload.update({
        collection: 'repositories',
        id: existing.docs[0].id,
        overrideAccess: true,
        context: { skipRevalidate: true },
        data: githubId === undefined ? rest : { ...rest, githubId },
      })
      repoIds.set(repo.fullName, existing.docs[0].id)
      counts.repositoriesUpdated++
      continue
    }
    const created = await payload.create({ collection: 'repositories', overrideAccess: true, context: { skipRevalidate: true }, data: repo })
    repoIds.set(repo.fullName, created.id)
    counts.repositoriesCreated++
  }

  for (const { repositoryFullName, ...plugin } of input.plugins) {
    const data = { ...plugin, repository: repoIds.get(repositoryFullName)! }
    const existing = await payload.find({
      collection: 'plugins',
      overrideAccess: true,
      trash: true,
      where: { slug: { equals: plugin.slug } },
      limit: 1,
    })
    if (existing.docs[0]) {
      // Visibility rule: admins own visibility of existing plugins, so a re-seed never writes 'listed'
      // over an admin's choice. The blocklist can only tighten it: a blocklisted slug is forced 'hidden'.
      // New plugins (create branch) take visibility from the blocklist as mapped.
      const { visibility, ...rest } = data
      const updateData = visibility === 'hidden' ? data : rest
      // trash: true — updateByID otherwise 404s on a trashed plugin. `data` has no deletedAt, so it stays trashed.
      await payload.update({ collection: 'plugins', id: existing.docs[0].id, overrideAccess: true, trash: true, context: { skipRevalidate: true }, data: updateData })
      counts.pluginsUpdated++
    } else {
      await payload.create({
        collection: 'plugins',
        overrideAccess: true,
        context: { skipRevalidate: true },
        data: { ...data, firstSeenAt: new Date().toISOString() },
      })
      counts.pluginsCreated++
    }
  }
  return counts
}

export const seedCommand = defineCLICommand({
  description:
    'One-time import of a legacy plugins.json export (slugs preserved; blocklisted ids hidden), then queue a discover run.',
  input: strictObject({
    file: z.string(),
    blocklist: z.optional(z.string()),
  }),
  handler: async ({ args, getPayload }) => {
    const payload = await getPayload()
    const data = JSON.parse(await readFile(args.file, 'utf8')) as LegacyPluginsData
    const extra = args.blocklist ? (JSON.parse(await readFile(args.blocklist, 'utf8')) as { ids: string[] }).ids : []
    const blocklist = [...new Set([...LEGACY_BLOCKLIST_IDS, ...extra])]
    const result = await seedDirectory(payload, mapLegacy(data, blocklist))
    // Spec §4 `seed`: the import is followed by a full sync (githubIds, full READMEs, fresh stats).
    await payload.jobs.queue({ task: 'discover', input: {}, queue: QUEUES.default, overrideAccess: true })
    payload.logger.info(result, 'Seed complete; discover queued for the next worker tick')
  },
})
