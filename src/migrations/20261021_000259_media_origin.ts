import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_media_origin" AS ENUM('maintainer', 'admin');
  ALTER TABLE "media" ADD COLUMN "origin" "enum_media_origin" DEFAULT 'admin';
  CREATE INDEX "media_origin_idx" ON "media" USING btree ("origin");
  -- Logos saved by maintainers before this column existed: <slug>-logo-<ms>[-<hex>].<ext>
  UPDATE "media" SET "origin" = 'maintainer' WHERE "filename" ~ '-logo-[0-9]+(-[0-9a-f]{6})?\\.(png|jpg|webp)$';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "media_origin_idx";
  ALTER TABLE "media" DROP COLUMN "origin";
  DROP TYPE "public"."enum_media_origin";`)
}
