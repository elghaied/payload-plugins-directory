import type { Payload } from 'payload'
import type { Plugin, Repository } from '@/payload-types'

let n = 0

/** A repository row with sensible defaults; override any field. */
export async function createRepo(payload: Payload, over: Partial<Repository> = {}): Promise<Repository> {
  n++
  return payload.create({
    collection: 'repositories',
    overrideAccess: true,
    depth: 0,
    data: { fullName: `acme/repo-${n}`, owner: 'acme', url: `https://github.com/acme/repo-${n}`, stars: 10, ...over } as never,
  })
}

/** A listed plugin of `repository`; override any field. */
export async function createPlugin(payload: Payload, repository: number, over: Partial<Plugin> = {}): Promise<Plugin> {
  n++
  return payload.create({
    collection: 'plugins',
    overrideAccess: true,
    depth: 0,
    data: { slug: `plugin-${n}`, name: `Plugin ${n}`, repository, url: `https://github.com/acme/plugin-${n}`, source: 'topic', ...over } as never,
  })
}
