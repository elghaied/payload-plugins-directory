import type { ReadmeRenderer } from '@/lib/directory/renderReadmeIsolated'
import type { GitHubClient } from './github'
import type { NpmClient } from './npm'

/** Renders README Markdown to sanitized HTML out of process; `version` identifies the pipeline (see readmeVersion.ts). */
export type ReadmeRendering = { render: ReadmeRenderer; version: () => string }

/**
 * What core sync functions need from the outside world; tests build it over fakeFetch. Without `readme` the
 * README HTML is left untouched (never rendered in-process).
 */
export type SyncContext = { github: GitHubClient; npm: NpmClient; now: () => Date; readme?: ReadmeRendering }
