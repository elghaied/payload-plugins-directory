import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_templates_payload_majors" AS ENUM('1', '2', '3', '4', 'unknown');
  CREATE TYPE "public"."enum_templates_source" AS ENUM('official', 'submission', 'converted');
  CREATE TYPE "public"."enum_templates_stack_detected" AS ENUM('nextjs', 'tanstack-start', 'other');
  CREATE TYPE "public"."enum_templates_stack_override" AS ENUM('nextjs', 'tanstack-start', 'other');
  CREATE TYPE "public"."enum_templates_visibility" AS ENUM('listed', 'hidden');
  CREATE TYPE "public"."enum_templates_sync_trash_reason" AS ENUM('repository-gone', 'package-removed');
  ALTER TYPE "public"."enum_media_origin" ADD VALUE 'template-screenshot';
  CREATE TABLE "templates_payload_majors" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_templates_payload_majors",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "templates" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"repository_id" integer NOT NULL,
  	"path" varchar,
  	"url" varchar NOT NULL,
  	"is_official" boolean DEFAULT false,
  	"source" "enum_templates_source" DEFAULT 'submission' NOT NULL,
  	"first_seen_at" timestamp(3) with time zone,
  	"description" varchar,
  	"readme" varchar,
  	"readme_truncated" boolean DEFAULT false,
  	"readme_html" varchar,
  	"readme_render_version" varchar,
  	"fallback_image_url" varchar,
  	"content_hash" varchar,
  	"payload_version_range" varchar,
  	"stack_detected" "enum_templates_stack_detected",
  	"stack_override" "enum_templates_stack_override",
  	"is_template_repo" boolean DEFAULT false,
  	"last_updated_at" timestamp(3) with time zone,
  	"license" varchar,
  	"category_id" integer,
  	"ai_tagline" varchar,
  	"ai_summary" varchar,
  	"ai_confidence" numeric,
  	"ai_model" varchar,
  	"ai_enriched_at" timestamp(3) with time zone,
  	"ai_enriched_hash" varchar,
  	"ai_prompt_hash" varchar,
  	"ai_failure" varchar,
  	"ai_failed_at" timestamp(3) with time zone,
  	"ai_failed_key" varchar,
  	"locks_category" boolean DEFAULT false,
  	"locks_tags" boolean DEFAULT false,
  	"locks_tagline" boolean DEFAULT false,
  	"locks_summary" boolean DEFAULT false,
  	"locks_features" boolean DEFAULT false,
  	"locks_use_cases" boolean DEFAULT false,
  	"custom_tagline" varchar,
  	"demo_url" varchar,
  	"video_url" varchar,
  	"visibility" "enum_templates_visibility" DEFAULT 'listed' NOT NULL,
  	"sync_trash_reason" "enum_templates_sync_trash_reason",
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "templates_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "templates_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"tags_id" integer,
  	"maintainers_id" integer,
  	"media_id" integer
  );
  
  ALTER TABLE "media" ADD COLUMN "variants_gallery_url" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_gallery_width" numeric;
  ALTER TABLE "media" ADD COLUMN "variants_gallery_height" numeric;
  ALTER TABLE "media" ADD COLUMN "variants_gallery_mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_gallery_filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "variants_gallery_filename" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_gallery_prefix" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_gallery__objectkey" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_card_url" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_card_width" numeric;
  ALTER TABLE "media" ADD COLUMN "variants_card_height" numeric;
  ALTER TABLE "media" ADD COLUMN "variants_card_mime_type" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_card_filesize" numeric;
  ALTER TABLE "media" ADD COLUMN "variants_card_filename" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_card_prefix" varchar;
  ALTER TABLE "media" ADD COLUMN "variants_card__objectkey" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "templates_id" integer;
  ALTER TABLE "templates_payload_majors" ADD CONSTRAINT "templates_payload_majors_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "templates" ADD CONSTRAINT "templates_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "templates" ADD CONSTRAINT "templates_category_id_template_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."template_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "templates_texts" ADD CONSTRAINT "templates_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "templates_rels" ADD CONSTRAINT "templates_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "templates_rels" ADD CONSTRAINT "templates_rels_tags_fk" FOREIGN KEY ("tags_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "templates_rels" ADD CONSTRAINT "templates_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "templates_rels" ADD CONSTRAINT "templates_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "templates_payload_majors_order_idx" ON "templates_payload_majors" USING btree ("order");
  CREATE INDEX "templates_payload_majors_parent_idx" ON "templates_payload_majors" USING btree ("parent_id");
  CREATE INDEX "templates_payload_majors_value_idx" ON "templates_payload_majors" USING btree ("value");
  CREATE UNIQUE INDEX "templates_slug_idx" ON "templates" USING btree ("slug");
  CREATE INDEX "templates_repository_idx" ON "templates" USING btree ("repository_id");
  CREATE INDEX "templates_is_official_idx" ON "templates" USING btree ("is_official");
  CREATE INDEX "templates_category_idx" ON "templates" USING btree ("category_id");
  CREATE INDEX "templates_visibility_idx" ON "templates" USING btree ("visibility");
  CREATE INDEX "templates_updated_at_idx" ON "templates" USING btree ("updated_at");
  CREATE INDEX "templates_created_at_idx" ON "templates" USING btree ("created_at");
  CREATE INDEX "templates_deleted_at_idx" ON "templates" USING btree ("deleted_at");
  CREATE INDEX "templates_texts_order_parent" ON "templates_texts" USING btree ("order","parent_id");
  CREATE INDEX "templates_rels_order_idx" ON "templates_rels" USING btree ("order");
  CREATE INDEX "templates_rels_parent_idx" ON "templates_rels" USING btree ("parent_id");
  CREATE INDEX "templates_rels_path_idx" ON "templates_rels" USING btree ("path");
  CREATE INDEX "templates_rels_tags_id_idx" ON "templates_rels" USING btree ("tags_id");
  CREATE INDEX "templates_rels_maintainers_id_idx" ON "templates_rels" USING btree ("maintainers_id");
  CREATE INDEX "templates_rels_media_id_idx" ON "templates_rels" USING btree ("media_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_templates_fk" FOREIGN KEY ("templates_id") REFERENCES "public"."templates"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "media_variants_gallery_variants_gallery_filename_idx" ON "media" USING btree ("variants_gallery_filename");
  CREATE INDEX "media_variants_card_variants_card_filename_idx" ON "media" USING btree ("variants_card_filename");
  CREATE INDEX "payload_locked_documents_rels_templates_id_idx" ON "payload_locked_documents_rels" USING btree ("templates_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "templates_payload_majors" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "templates" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "templates_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "templates_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "templates_payload_majors" CASCADE;
  DROP TABLE "templates" CASCADE;
  DROP TABLE "templates_texts" CASCADE;
  DROP TABLE "templates_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_templates_fk";
  
  ALTER TABLE "media" ALTER COLUMN "origin" SET DATA TYPE text;
  ALTER TABLE "media" ALTER COLUMN "origin" SET DEFAULT 'admin'::text;
  DROP TYPE "public"."enum_media_origin";
  CREATE TYPE "public"."enum_media_origin" AS ENUM('maintainer', 'admin');
  ALTER TABLE "media" ALTER COLUMN "origin" SET DEFAULT 'admin'::"public"."enum_media_origin";
  ALTER TABLE "media" ALTER COLUMN "origin" SET DATA TYPE "public"."enum_media_origin" USING "origin"::"public"."enum_media_origin";
  DROP INDEX "media_variants_gallery_variants_gallery_filename_idx";
  DROP INDEX "media_variants_card_variants_card_filename_idx";
  DROP INDEX "payload_locked_documents_rels_templates_id_idx";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_url";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_width";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_height";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_mime_type";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_filesize";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_filename";
  ALTER TABLE "media" DROP COLUMN "variants_gallery_prefix";
  ALTER TABLE "media" DROP COLUMN "variants_gallery__objectkey";
  ALTER TABLE "media" DROP COLUMN "variants_card_url";
  ALTER TABLE "media" DROP COLUMN "variants_card_width";
  ALTER TABLE "media" DROP COLUMN "variants_card_height";
  ALTER TABLE "media" DROP COLUMN "variants_card_mime_type";
  ALTER TABLE "media" DROP COLUMN "variants_card_filesize";
  ALTER TABLE "media" DROP COLUMN "variants_card_filename";
  ALTER TABLE "media" DROP COLUMN "variants_card_prefix";
  ALTER TABLE "media" DROP COLUMN "variants_card__objectkey";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "templates_id";
  DROP TYPE "public"."enum_templates_payload_majors";
  DROP TYPE "public"."enum_templates_source";
  DROP TYPE "public"."enum_templates_stack_detected";
  DROP TYPE "public"."enum_templates_stack_override";
  DROP TYPE "public"."enum_templates_visibility";
  DROP TYPE "public"."enum_templates_sync_trash_reason";`)
}
