/** `default`: discover, discover-templates, npm-stats, snapshot, revalidate, enrich-all, enrich-batch. `sync`: sync-repository, sync-template. `enrich`: enrich. */
export const QUEUES = { default: 'default', sync: 'sync', enrich: 'enrich' } as const
