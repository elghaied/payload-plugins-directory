import type { SyncContext } from './context'
import { createGitHubClient } from './github'
import { withTimeout, type FetchFn } from './http'
import { createNpmClient } from './npm'

export type SyncEnv = { githubToken?: string; revalidateSecret?: string; internalWebUrl: string }
export type SyncDeps = { fetch: FetchFn; now: () => Date; env: SyncEnv }

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

export function createSyncContext(deps: SyncDeps): SyncContext {
  return {
    github: createGitHubClient({ fetch: deps.fetch, token: deps.env.githubToken, now: deps.now }),
    npm: createNpmClient({ fetch: deps.fetch, now: deps.now }),
    now: deps.now,
  }
}
