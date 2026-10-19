import type { SyncContext } from '@/sync/context'
import { createGitHubClient } from '@/sync/github'
import type { FetchFn } from '@/sync/http'
import { createNpmClient } from '@/sync/npm'
import { fakeFetch, type FakeFetch, type FakeRoute } from '../../helpers/fakeFetch'
import { RAW } from '../../fixtures/sync/github'

/** SyncContext over an injected fetch with a fixed clock: the one way integration tests build sync deps. */
export function syncContext(f: FetchFn, now: Date): SyncContext {
  return {
    github: createGitHubClient({ fetch: f, now: () => now }),
    npm: createNpmClient({ fetch: f, now: () => now }),
    now: () => now,
  }
}

/** fakeFetch where any unrouted raw.githubusercontent.com file is a 404 (missing READMEs etc.); other unknown URLs reject. */
export function syncFetch(routes: Record<string, FakeRoute> = {}): FakeFetch {
  return fakeFetch(routes, { notFoundPrefixes: [RAW] })
}
