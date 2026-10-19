import type { GitHubClient } from './github'
import type { NpmClient } from './npm'

/** What core sync functions need from the outside world; tests build it over fakeFetch. */
export type SyncContext = { github: GitHubClient; npm: NpmClient; now: () => Date }
