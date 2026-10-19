/** `default`: discover, npm-stats, snapshot, revalidate. `sync`: sync-repository (spec §4 "concurrency 4"). Phase 2 adds `enrich`. */
export const QUEUES = { default: 'default', sync: 'sync' } as const
