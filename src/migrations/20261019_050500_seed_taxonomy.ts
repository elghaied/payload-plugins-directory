import type { MigrateDownArgs, MigrateUpArgs } from '@payloadcms/db-postgres'
import { seedTaxonomy } from '../taxonomy/seed'

/**
 * Data migration: starter categories, alias tags and the admin presets (spec §3.1, §9). It runs exactly once
 * per database, so a deploy needs no manual step and categories an admin deleted later are not recreated.
 * Existing rows with the same slug/title are skipped, so admin-created taxonomy is never touched, and it
 * writes no plugin, so admin-locked tags are unaffected.
 */
export async function up({ payload, req }: MigrateUpArgs): Promise<void> {
  const result = await seedTaxonomy(payload, { req })
  payload.logger.info(
    { categories: result.categoriesCreated.length, tags: result.tagsCreated.length, presets: result.presetsCreated.length },
    'Seeded starter taxonomy',
  )
}

export async function down(_args: MigrateDownArgs): Promise<void> {
  // Intentionally empty: rolling back schema must never delete taxonomy admins have edited since.
}
