import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "submissions" ADD COLUMN "repository_full_name" varchar;
  ALTER TABLE "_submissions_v" ADD COLUMN "version_repository_full_name" varchar;
  CREATE INDEX "submissions_repository_full_name_idx" ON "submissions" USING btree ("repository_full_name");
  CREATE INDEX "_submissions_v_version_version_repository_full_name_idx" ON "_submissions_v" USING btree ("version_repository_full_name");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "submissions_repository_full_name_idx";
  DROP INDEX "_submissions_v_version_version_repository_full_name_idx";
  ALTER TABLE "submissions" DROP COLUMN "repository_full_name";
  ALTER TABLE "_submissions_v" DROP COLUMN "version_repository_full_name";`)
}
