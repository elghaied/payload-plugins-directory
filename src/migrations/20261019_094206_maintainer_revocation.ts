import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "maintainers" ADD COLUMN "blocked" boolean DEFAULT false;
  ALTER TABLE "maintainers" ADD COLUMN "sessions_valid_after" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "maintainers" DROP COLUMN "blocked";
  ALTER TABLE "maintainers" DROP COLUMN "sessions_valid_after";`)
}
