import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// Additive: one enum value and one nullable relation column. The hand-added `fts` column and its GIN index
// (20261021_011329_search_index) are untouched; template rows get their tsvector from the same generated expression.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_search_kind" ADD VALUE 'template';
  ALTER TABLE "search_rels" ADD COLUMN "templates_id" integer;
  ALTER TABLE "search_rels" ADD CONSTRAINT "search_rels_templates_fk" FOREIGN KEY ("templates_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "search_rels_templates_id_idx" ON "search_rels" USING btree ("templates_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Template rows cannot be cast back to the old enum: drop them first (reindex-search rebuilds them on the way up).
  await db.execute(sql`
   DELETE FROM "search" WHERE "kind" = 'template';
   ALTER TABLE "search_rels" DROP CONSTRAINT "search_rels_templates_fk";
  
  ALTER TABLE "search" ALTER COLUMN "kind" SET DATA TYPE text;
  DROP TYPE "public"."enum_search_kind";
  CREATE TYPE "public"."enum_search_kind" AS ENUM('plugin', 'category', 'tag');
  ALTER TABLE "search" ALTER COLUMN "kind" SET DATA TYPE "public"."enum_search_kind" USING "kind"::"public"."enum_search_kind";
  DROP INDEX "search_rels_templates_id_idx";
  ALTER TABLE "search_rels" DROP COLUMN "templates_id";`)
}
