import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_search_kind" AS ENUM('plugin', 'category', 'tag');
  CREATE TABLE "search" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar,
  	"priority" numeric,
  	"kind" "enum_search_kind" NOT NULL,
  	"slug" varchar NOT NULL,
  	"tagline" varchar,
  	"summary" varchar,
  	"category_text" varchar,
  	"tags_text" varchar,
  	"readme" varchar,
  	"path" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "search_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"plugins_id" integer,
  	"categories_id" integer,
  	"tags_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "search_id" integer;
  ALTER TABLE "search_rels" ADD CONSTRAINT "search_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."search"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "search_rels" ADD CONSTRAINT "search_rels_plugins_fk" FOREIGN KEY ("plugins_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "search_rels" ADD CONSTRAINT "search_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "search_rels" ADD CONSTRAINT "search_rels_tags_fk" FOREIGN KEY ("tags_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "search_kind_idx" ON "search" USING btree ("kind");
  CREATE INDEX "search_slug_idx" ON "search" USING btree ("slug");
  CREATE INDEX "search_updated_at_idx" ON "search" USING btree ("updated_at");
  CREATE INDEX "search_created_at_idx" ON "search" USING btree ("created_at");
  CREATE INDEX "search_rels_order_idx" ON "search_rels" USING btree ("order");
  CREATE INDEX "search_rels_parent_idx" ON "search_rels" USING btree ("parent_id");
  CREATE INDEX "search_rels_path_idx" ON "search_rels" USING btree ("path");
  CREATE INDEX "search_rels_plugins_id_idx" ON "search_rels" USING btree ("plugins_id");
  CREATE INDEX "search_rels_categories_id_idx" ON "search_rels" USING btree ("categories_id");
  CREATE INDEX "search_rels_tags_id_idx" ON "search_rels" USING btree ("tags_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_search_fk" FOREIGN KEY ("search_id") REFERENCES "public"."search"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_search_id_idx" ON "payload_locked_documents_rels" USING btree ("search_id");`)
  // Full-text vector over the search record: A = name/slug, B = tagline/category/tags, C = summary +
  // author description, D = README excerpt. Hand-written: generated columns stay outside Payload's field
  // layer, and drizzle-kit diffs migration snapshots, so later migrate:create runs will not drop it.
  await db.execute(sql`
    ALTER TABLE "search" ADD COLUMN "fts" tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('english'::regconfig, coalesce("title", '') || ' ' || coalesce("slug", '')), 'A') ||
      setweight(to_tsvector('english'::regconfig, coalesce("tagline", '') || ' ' || coalesce("category_text", '') || ' ' || coalesce("tags_text", '')), 'B') ||
      setweight(to_tsvector('english'::regconfig, coalesce("summary", '')), 'C') ||
      setweight(to_tsvector('english'::regconfig, coalesce("readme", '')), 'D')
    ) STORED;
    CREATE INDEX "search_fts_idx" ON "search" USING gin ("fts");
  `)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP INDEX IF EXISTS "search_fts_idx";
    ALTER TABLE "search" DROP COLUMN IF EXISTS "fts";
  `)
  await db.execute(sql`
   ALTER TABLE "search" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "search_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "search" CASCADE;
  DROP TABLE "search_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_search_fk";
  
  DROP INDEX "payload_locked_documents_rels_search_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "search_id";
  DROP TYPE "public"."enum_search_kind";`)
}
