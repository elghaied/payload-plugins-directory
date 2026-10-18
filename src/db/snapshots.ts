import { date, integer, pgTable, primaryKey, real } from '@payloadcms/db-postgres/drizzle/pg-core'

export const repositorySnapshots = pgTable(
  'repository_snapshots',
  {
    repositoryId: integer('repository_id').notNull(),
    date: date('date').notNull(),
    stars: integer('stars').notNull(),
    forks: integer('forks').notNull(),
    openIssues: integer('open_issues').notNull(),
  },
  (t) => [primaryKey({ columns: [t.repositoryId, t.date] })],
)

export const pluginSnapshots = pgTable(
  'plugin_snapshots',
  {
    pluginId: integer('plugin_id').notNull(),
    date: date('date').notNull(),
    weeklyDownloads: integer('weekly_downloads'),
    healthScore: real('health_score'),
  },
  (t) => [primaryKey({ columns: [t.pluginId, t.date] })],
)
