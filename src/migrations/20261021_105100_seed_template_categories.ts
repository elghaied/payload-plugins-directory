import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import { seedTemplateCategories } from '../taxonomy/templateSeed'

/**
 * Data migration: the starter template categories (Phase 6). Runs exactly once per database; categories an admin
 * deleted later are not recreated, and existing slugs are never touched.
 */
export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const result = await seedTemplateCategories(payload, { req })
  payload.logger.info({ categories: result.created.length }, 'Seeded starter template categories')
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Intentionally empty: rolling back schema must never delete taxonomy admins have edited since.
}
