import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "plugins" ADD COLUMN "readme_html" varchar;
  ALTER TABLE "plugins" ADD COLUMN "readme_render_version" varchar;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "plugins" DROP COLUMN "readme_html";
  ALTER TABLE "plugins" DROP COLUMN "readme_render_version";`)
}
