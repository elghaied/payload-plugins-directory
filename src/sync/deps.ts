import { enrichClientFromEnv } from '@/enrich/client'
import type { EnrichClient } from '@/enrich/types'
import { renderReadmeIsolated } from '@/lib/directory/renderReadmeIsolated'
import { readmeRenderVersion } from '@/lib/directory/readmeVersion'
import type { ReadmeRendering, SyncContext } from './context'
import { createGitHubClient } from './github'
import { withTimeout, type FetchFn } from './http'
import { createNpmClient } from './npm'

export type SyncEnv = { githubToken?: string; revalidateSecret?: string; internalWebUrl: string }
export type SyncDeps = {
  fetch: FetchFn
  now: () => Date
  env: SyncEnv
  /** Tests: setSyncDeps({ enrichClient: fakeEnrichClient(…) }) or `null`. Unset = real client from ANTHROPIC_API_KEY. */
  enrichClient?: EnrichClient | null
  /** Tests: a fake README renderer (the real one starts a worker thread). Unset = the isolated worker renderer. */
  readme?: ReadmeRendering
}

export function readSyncEnv(env: Record<string, string | undefined> = process.env): SyncEnv {
  return {
    githubToken: env.GITHUB_TOKEN || undefined,
    revalidateSecret: env.REVALIDATE_SECRET || undefined,
    internalWebUrl: (env.INTERNAL_WEB_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  }
}

let overrides: Partial<SyncDeps> | null = null

/** Tests only: replace fetch / clock / env for task handlers run through payload.jobs. `null` restores the defaults. */
export function setSyncDeps(next: Partial<SyncDeps> | null): void {
  overrides = next
}

/** Every fetch (GitHub, npm and the revalidate POST) goes through `withTimeout`, overrides included. */
export function getSyncDeps(): SyncDeps {
  const deps: SyncDeps = {
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => new Date(),
    env: readSyncEnv(),
    ...overrides,
  }
  return { ...deps, fetch: withTimeout(deps.fetch) }
}

/**
 * The README renderer exists only in the worker process (DIRECTORY_ROLE=worker): it needs the sources on disk and
 * starts worker threads. Anywhere else (web, an admin-triggered /api/payload-jobs/run) sync leaves README HTML alone.
 */
export function defaultReadmeRendering(): ReadmeRendering | undefined {
  if (process.env.DIRECTORY_ROLE !== 'worker') return undefined
  return { render: (source, repo) => renderReadmeIsolated(source, repo), version: readmeRenderVersion }
}

export function createSyncContext(deps: SyncDeps): SyncContext {
  return {
    github: createGitHubClient({ fetch: deps.fetch, token: deps.env.githubToken, now: deps.now }),
    npm: createNpmClient({ fetch: deps.fetch, now: deps.now }),
    now: deps.now,
    readme: deps.readme ?? defaultReadmeRendering(),
  }
}

let envEnrichClient: EnrichClient | null | undefined

/** The Anthropic client for enrichment tasks: the test override when set (even `null`), else one real client per process. */
export function getEnrichClient(deps: SyncDeps): EnrichClient | null {
  if (deps.enrichClient !== undefined) return deps.enrichClient
  if (envEnrichClient === undefined) envEnrichClient = enrichClientFromEnv()
  return envEnrichClient
}
