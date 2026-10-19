import { jsonb, pgTable, text, timestamp } from '@payloadcms/db-postgres/drizzle/pg-core'

/**
 * One row per sync task slug, plus `github-quota`: last success / failure for the job-health widget (spec §9).
 * `payload-jobs` cannot answer this because v4 deletes successful jobs (`deleteJobOnComplete` defaults to true).
 */
export const jobStatus = pgTable('job_status', {
  key: text('key').primaryKey(),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'date' }),
  lastFailureAt: timestamp('last_failure_at', { withTimezone: true, mode: 'date' }),
  lastError: text('last_error'),
  details: jsonb('details').$type<Record<string, unknown>>(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
})
