import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_origin" AS ENUM('maintainer', 'admin');
  ALTER TABLE "media" ADD COLUMN "origin" "enum_media_origin" DEFAULT 'admin';
  CREATE INDEX "media_origin_idx" ON "media" USING btree ("origin");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "media_origin_idx";
  ALTER TABLE "media" DROP COLUMN "origin";
  DROP TYPE "public"."enum_media_origin";`)
}
