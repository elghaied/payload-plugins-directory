/** `default`: discover, npm-stats, snapshot, revalidate, enrich-all, enrich-batch. `sync`: sync-repository. `enrich`: enrich. */
export const QUEUES = { default: 'default', sync: 'sync', enrich: 'enrich' } as const
