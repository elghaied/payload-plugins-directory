import { readFile } from 'fs/promises'
import type { Payload } from 'payload'
import { strictObject, z } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { mapLegacy, type LegacyPluginsData } from '@/lib/seed/mapLegacy'

export async function seedDirectory(payload: Payload, input: ReturnType<typeof mapLegacy>) {
  const counts = { repositoriesCreated: 0, pluginsCreated: 0, pluginsUpdated: 0 }
  const repoIds = new Map<string, number>()

  for (const repo of input.repositories) {
    const existing = await payload.find({
      collection: 'repositories',
      overrideAccess: true,
      where: { fullName: { equals: repo.fullName } },
      limit: 1,
    })
    if (existing.docs[0]) {
      repoIds.set(repo.fullName, existing.docs[0].id)
      continue
    }
    const created = await payload.create({ collection: 'repositories', overrideAccess: true, data: repo })
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
      await payload.update({ collection: 'plugins', id: existing.docs[0].id, overrideAccess: true, data })
      counts.pluginsUpdated++
    } else {
      await payload.create({
        collection: 'plugins',
        overrideAccess: true,
        data: { ...data, firstSeenAt: new Date().toISOString() },
      })
      counts.pluginsCreated++
    }
  }
  return counts
}

export const seedCommand = defineCLICommand({
  description: 'Import data/plugins.json and data/blocklist.json into the database (idempotent).',
  input: strictObject({
    file: z._default(z.string(), 'data/plugins.json'),
    blocklist: z._default(z.string(), 'data/blocklist.json'),
  }),
  handler: async ({ args, getPayload }) => {
    const payload = await getPayload()
    const data = JSON.parse(await readFile(args.file, 'utf8')) as LegacyPluginsData
    const blocklist = (JSON.parse(await readFile(args.blocklist, 'utf8')) as { ids: string[] }).ids
    const result = await seedDirectory(payload, mapLegacy(data, blocklist))
    payload.logger.info(result, 'Seed complete')
  },
})
