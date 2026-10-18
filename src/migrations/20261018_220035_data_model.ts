import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_plugins_payload_majors" AS ENUM('1', '2', '3', '4', 'unknown');
  CREATE TYPE "public"."enum_plugins_source" AS ENUM('topic', 'official', 'submission');
  CREATE TYPE "public"."enum_plugins_visibility" AS ENUM('listed', 'hidden');
  CREATE TYPE "public"."enum_tags_created_by" AS ENUM('admin', 'alias', 'ai');
  CREATE TYPE "public"."enum__tags_v_version_created_by" AS ENUM('admin', 'alias', 'ai');
  CREATE TYPE "public"."enum_submissions_type" AS ENUM('listing', 'claim');
  CREATE TYPE "public"."enum_submissions_status" AS ENUM('pending', 'approved', 'rejected', 'duplicate');
  CREATE TYPE "public"."enum__submissions_v_version_type" AS ENUM('listing', 'claim');
  CREATE TYPE "public"."enum__submissions_v_version_status" AS ENUM('pending', 'approved', 'rejected', 'duplicate');
  CREATE TABLE "repository_snapshots" (
  	"repository_id" integer NOT NULL,
  	"date" date NOT NULL,
  	"stars" integer NOT NULL,
  	"forks" integer NOT NULL,
  	"open_issues" integer NOT NULL,
  	CONSTRAINT "repository_snapshots_repository_id_date_pk" PRIMARY KEY("repository_id","date")
  );
  
  CREATE TABLE "plugin_snapshots" (
  	"plugin_id" integer NOT NULL,
  	"date" date NOT NULL,
  	"weekly_downloads" integer,
  	"health_score" real,
  	CONSTRAINT "plugin_snapshots_plugin_id_date_pk" PRIMARY KEY("plugin_id","date")
  );
  
  CREATE TABLE "maintainers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"github_id" numeric NOT NULL,
  	"login" varchar NOT NULL,
  	"name" varchar,
  	"avatar_url" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "maintainers_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_maintainers_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_github_id" numeric NOT NULL,
  	"version_login" varchar NOT NULL,
  	"version_name" varchar,
  	"version_avatar_url" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_maintainers_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "repositories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"full_name" varchar NOT NULL,
  	"github_id" numeric,
  	"owner" varchar NOT NULL,
  	"owner_avatar" varchar,
  	"url" varchar NOT NULL,
  	"description" varchar,
  	"stars" numeric DEFAULT 0,
  	"forks" numeric DEFAULT 0,
  	"open_issues" numeric DEFAULT 0,
  	"license" varchar,
  	"is_archived" boolean DEFAULT false,
  	"pushed_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"default_branch" varchar,
  	"is_monorepo" boolean DEFAULT false,
  	"last_synced_at" timestamp(3) with time zone,
  	"missed_discoveries" numeric DEFAULT 0,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "repositories_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "repositories_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "plugins_payload_majors" (
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"value" "enum_plugins_payload_majors",
  	"id" serial PRIMARY KEY NOT NULL
  );
  
  CREATE TABLE "plugins" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"package_name" varchar,
  	"repository_id" integer NOT NULL,
  	"path" varchar,
  	"url" varchar NOT NULL,
  	"is_official" boolean DEFAULT false,
  	"source" "enum_plugins_source" DEFAULT 'topic' NOT NULL,
  	"first_seen_at" timestamp(3) with time zone,
  	"description" varchar,
  	"readme" varchar,
  	"content_hash" varchar,
  	"payload_version_range" varchar,
  	"npm_weekly_downloads" numeric,
  	"npm_monthly_downloads" numeric,
  	"npm_latest_version" varchar,
  	"npm_unpacked_size" numeric,
  	"npm_last_publish" timestamp(3) with time zone,
  	"npm_dependency_count" numeric,
  	"health_score" numeric,
  	"category_id" integer,
  	"ai_tagline" varchar,
  	"ai_summary" varchar,
  	"ai_confidence" numeric,
  	"ai_model" varchar,
  	"ai_enriched_at" timestamp(3) with time zone,
  	"ai_enriched_hash" varchar,
  	"locks_category" boolean DEFAULT false,
  	"locks_tags" boolean DEFAULT false,
  	"locks_tagline" boolean DEFAULT false,
  	"locks_summary" boolean DEFAULT false,
  	"locks_features" boolean DEFAULT false,
  	"locks_use_cases" boolean DEFAULT false,
  	"custom_tagline" varchar,
  	"logo_id" integer,
  	"visibility" "enum_plugins_visibility" DEFAULT 'listed' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"deleted_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "plugins_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "plugins_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"tags_id" integer,
  	"maintainers_id" integer,
  	"users_id" integer
  );
  
  CREATE TABLE "categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"intro" varchar,
  	"icon" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "categories_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_categories_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_parent_id" integer,
  	"version_title" varchar NOT NULL,
  	"version_slug" varchar NOT NULL,
  	"version_intro" varchar,
  	"version_icon" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_categories_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "tags" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"_h_tags_id" integer,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"created_by" "enum_tags_created_by" DEFAULT 'admin',
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tags_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "tags_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_tags_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version__h_tags_id" integer,
  	"version_title" varchar NOT NULL,
  	"version_slug" varchar NOT NULL,
  	"version_created_by" "enum__tags_v_version_created_by" DEFAULT 'admin',
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_tags_v_texts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer NOT NULL,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"text" varchar
  );
  
  CREATE TABLE "_tags_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "submissions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"type" "enum_submissions_type" DEFAULT 'listing' NOT NULL,
  	"url" varchar,
  	"plugin_id" integer,
  	"submitted_by_id" integer NOT NULL,
  	"note" varchar,
  	"status" "enum_submissions_status" DEFAULT 'pending' NOT NULL,
  	"rejection_reason" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "submissions_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_submissions_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_type" "enum__submissions_v_version_type" DEFAULT 'listing' NOT NULL,
  	"version_url" varchar,
  	"version_plugin_id" integer,
  	"version_submitted_by_id" integer NOT NULL,
  	"version_note" varchar,
  	"version_status" "enum__submissions_v_version_status" DEFAULT 'pending' NOT NULL,
  	"version_rejection_reason" varchar,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_submissions_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"original_filename" varchar,
  	"original_url" varchar,
  	"original_mime_type" varchar,
  	"original_filesize" numeric,
  	"original_width" numeric,
  	"original_height" numeric,
  	"original_prefix" varchar,
  	"original__objectkey" varchar,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "media_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_media_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_alt" varchar NOT NULL,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version_url" varchar,
  	"version_thumbnail_u_r_l" varchar,
  	"version_filename" varchar,
  	"version_mime_type" varchar,
  	"version_filesize" numeric,
  	"version_width" numeric,
  	"version_height" numeric,
  	"version_original_filename" varchar,
  	"version_original_url" varchar,
  	"version_original_mime_type" varchar,
  	"version_original_filesize" numeric,
  	"version_original_width" numeric,
  	"version_original_height" numeric,
  	"version_original_prefix" varchar,
  	"version_original__objectkey" varchar,
  	"version_focal_x" numeric,
  	"version_focal_y" numeric,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_media_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "directory_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"announcement_text" varchar,
  	"announcement_link" varchar,
  	"ai_enabled" boolean DEFAULT true,
  	"ai_model" varchar DEFAULT 'claude-sonnet-5-5',
  	"ai_instructions" varchar,
  	"ai_max_new_tags_per_plugin" numeric DEFAULT 2,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  CREATE TABLE "directory_settings_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"plugins_id" integer,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_directory_settings_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"version_announcement_text" varchar,
  	"version_announcement_link" varchar,
  	"version_ai_enabled" boolean DEFAULT true,
  	"version_ai_model" varchar DEFAULT 'claude-sonnet-5-5',
  	"version_ai_instructions" varchar,
  	"version_ai_max_new_tags_per_plugin" numeric DEFAULT 2,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "_directory_settings_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"plugins_id" integer,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  ALTER TABLE "users_rels" ADD COLUMN "maintainers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "maintainers_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "repositories_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "plugins_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "categories_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "tags_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "submissions_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "media_id" integer;
  ALTER TABLE "payload_preferences_rels" ADD COLUMN "maintainers_id" integer;
  ALTER TABLE "payload_llm_instructions_rels" ADD COLUMN "maintainers_id" integer;
  ALTER TABLE "maintainers_rels" ADD CONSTRAINT "maintainers_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "maintainers_rels" ADD CONSTRAINT "maintainers_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "maintainers_rels" ADD CONSTRAINT "maintainers_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_maintainers_v" ADD CONSTRAINT "_maintainers_v_parent_id_maintainers_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."maintainers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_maintainers_v_rels" ADD CONSTRAINT "_maintainers_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_maintainers_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_maintainers_v_rels" ADD CONSTRAINT "_maintainers_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_maintainers_v_rels" ADD CONSTRAINT "_maintainers_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "repositories_texts" ADD CONSTRAINT "repositories_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "repositories_rels" ADD CONSTRAINT "repositories_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "repositories_rels" ADD CONSTRAINT "repositories_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "repositories_rels" ADD CONSTRAINT "repositories_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "plugins_payload_majors" ADD CONSTRAINT "plugins_payload_majors_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "plugins" ADD CONSTRAINT "plugins_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "plugins" ADD CONSTRAINT "plugins_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "plugins" ADD CONSTRAINT "plugins_logo_id_media_id_fk" FOREIGN KEY ("logo_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "plugins_texts" ADD CONSTRAINT "plugins_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "plugins_rels" ADD CONSTRAINT "plugins_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "plugins_rels" ADD CONSTRAINT "plugins_rels_tags_fk" FOREIGN KEY ("tags_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "plugins_rels" ADD CONSTRAINT "plugins_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "plugins_rels" ADD CONSTRAINT "plugins_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories_rels" ADD CONSTRAINT "categories_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "categories_rels" ADD CONSTRAINT "categories_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "categories_rels" ADD CONSTRAINT "categories_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_categories_v" ADD CONSTRAINT "_categories_v_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_categories_v" ADD CONSTRAINT "_categories_v_version_parent_id_categories_id_fk" FOREIGN KEY ("version_parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_categories_v_rels" ADD CONSTRAINT "_categories_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_categories_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_categories_v_rels" ADD CONSTRAINT "_categories_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_categories_v_rels" ADD CONSTRAINT "_categories_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tags" ADD CONSTRAINT "tags__h_tags_id_tags_id_fk" FOREIGN KEY ("_h_tags_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tags_texts" ADD CONSTRAINT "tags_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tags_rels" ADD CONSTRAINT "tags_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tags_rels" ADD CONSTRAINT "tags_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tags_rels" ADD CONSTRAINT "tags_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_tags_v" ADD CONSTRAINT "_tags_v_parent_id_tags_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_tags_v" ADD CONSTRAINT "_tags_v_version__h_tags_id_tags_id_fk" FOREIGN KEY ("version__h_tags_id") REFERENCES "public"."tags"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_tags_v_texts" ADD CONSTRAINT "_tags_v_texts_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_tags_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_tags_v_rels" ADD CONSTRAINT "_tags_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_tags_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_tags_v_rels" ADD CONSTRAINT "_tags_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_tags_v_rels" ADD CONSTRAINT "_tags_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "submissions" ADD CONSTRAINT "submissions_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "submissions" ADD CONSTRAINT "submissions_submitted_by_id_maintainers_id_fk" FOREIGN KEY ("submitted_by_id") REFERENCES "public"."maintainers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "submissions_rels" ADD CONSTRAINT "submissions_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "submissions_rels" ADD CONSTRAINT "submissions_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "submissions_rels" ADD CONSTRAINT "submissions_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_submissions_v" ADD CONSTRAINT "_submissions_v_parent_id_submissions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."submissions"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_submissions_v" ADD CONSTRAINT "_submissions_v_version_plugin_id_plugins_id_fk" FOREIGN KEY ("version_plugin_id") REFERENCES "public"."plugins"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_submissions_v" ADD CONSTRAINT "_submissions_v_version_submitted_by_id_maintainers_id_fk" FOREIGN KEY ("version_submitted_by_id") REFERENCES "public"."maintainers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_submissions_v_rels" ADD CONSTRAINT "_submissions_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_submissions_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_submissions_v_rels" ADD CONSTRAINT "_submissions_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_submissions_v_rels" ADD CONSTRAINT "_submissions_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media_rels" ADD CONSTRAINT "media_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media_rels" ADD CONSTRAINT "media_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "media_rels" ADD CONSTRAINT "media_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v" ADD CONSTRAINT "_media_v_parent_id_media_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_media_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "directory_settings_rels" ADD CONSTRAINT "directory_settings_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."directory_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "directory_settings_rels" ADD CONSTRAINT "directory_settings_rels_plugins_fk" FOREIGN KEY ("plugins_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "directory_settings_rels" ADD CONSTRAINT "directory_settings_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "directory_settings_rels" ADD CONSTRAINT "directory_settings_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_directory_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_plugins_fk" FOREIGN KEY ("plugins_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "maintainers_github_id_idx" ON "maintainers" USING btree ("github_id");
  CREATE INDEX "maintainers_login_idx" ON "maintainers" USING btree ("login");
  CREATE INDEX "maintainers_updated_at_idx" ON "maintainers" USING btree ("updated_at");
  CREATE INDEX "maintainers_created_at_idx" ON "maintainers" USING btree ("created_at");
  CREATE INDEX "maintainers_rels_order_idx" ON "maintainers_rels" USING btree ("order");
  CREATE INDEX "maintainers_rels_parent_idx" ON "maintainers_rels" USING btree ("parent_id");
  CREATE INDEX "maintainers_rels_path_idx" ON "maintainers_rels" USING btree ("path");
  CREATE INDEX "maintainers_rels_users_id_idx" ON "maintainers_rels" USING btree ("users_id");
  CREATE INDEX "maintainers_rels_maintainers_id_idx" ON "maintainers_rels" USING btree ("maintainers_id");
  CREATE INDEX "_maintainers_v_parent_idx" ON "_maintainers_v" USING btree ("parent_id");
  CREATE INDEX "_maintainers_v_version_version_github_id_idx" ON "_maintainers_v" USING btree ("version_github_id");
  CREATE INDEX "_maintainers_v_version_version_login_idx" ON "_maintainers_v" USING btree ("version_login");
  CREATE INDEX "_maintainers_v_version_version_updated_at_idx" ON "_maintainers_v" USING btree ("version_updated_at");
  CREATE INDEX "_maintainers_v_version_version_created_at_idx" ON "_maintainers_v" USING btree ("version_created_at");
  CREATE INDEX "_maintainers_v_created_at_idx" ON "_maintainers_v" USING btree ("created_at");
  CREATE INDEX "_maintainers_v_updated_at_idx" ON "_maintainers_v" USING btree ("updated_at");
  CREATE INDEX "_maintainers_v_rels_order_idx" ON "_maintainers_v_rels" USING btree ("order");
  CREATE INDEX "_maintainers_v_rels_parent_idx" ON "_maintainers_v_rels" USING btree ("parent_id");
  CREATE INDEX "_maintainers_v_rels_path_idx" ON "_maintainers_v_rels" USING btree ("path");
  CREATE INDEX "_maintainers_v_rels_users_id_idx" ON "_maintainers_v_rels" USING btree ("users_id");
  CREATE INDEX "_maintainers_v_rels_maintainers_id_idx" ON "_maintainers_v_rels" USING btree ("maintainers_id");
  CREATE UNIQUE INDEX "repositories_full_name_idx" ON "repositories" USING btree ("full_name");
  CREATE UNIQUE INDEX "repositories_github_id_idx" ON "repositories" USING btree ("github_id");
  CREATE INDEX "repositories_owner_idx" ON "repositories" USING btree ("owner");
  CREATE INDEX "repositories_stars_idx" ON "repositories" USING btree ("stars");
  CREATE INDEX "repositories_updated_at_idx" ON "repositories" USING btree ("updated_at");
  CREATE INDEX "repositories_texts_order_parent" ON "repositories_texts" USING btree ("order","parent_id");
  CREATE INDEX "repositories_rels_order_idx" ON "repositories_rels" USING btree ("order");
  CREATE INDEX "repositories_rels_parent_idx" ON "repositories_rels" USING btree ("parent_id");
  CREATE INDEX "repositories_rels_path_idx" ON "repositories_rels" USING btree ("path");
  CREATE INDEX "repositories_rels_users_id_idx" ON "repositories_rels" USING btree ("users_id");
  CREATE INDEX "repositories_rels_maintainers_id_idx" ON "repositories_rels" USING btree ("maintainers_id");
  CREATE INDEX "plugins_payload_majors_order_idx" ON "plugins_payload_majors" USING btree ("order");
  CREATE INDEX "plugins_payload_majors_parent_idx" ON "plugins_payload_majors" USING btree ("parent_id");
  CREATE INDEX "plugins_payload_majors_value_idx" ON "plugins_payload_majors" USING btree ("value");
  CREATE UNIQUE INDEX "plugins_slug_idx" ON "plugins" USING btree ("slug");
  CREATE INDEX "plugins_package_name_idx" ON "plugins" USING btree ("package_name");
  CREATE INDEX "plugins_repository_idx" ON "plugins" USING btree ("repository_id");
  CREATE INDEX "plugins_is_official_idx" ON "plugins" USING btree ("is_official");
  CREATE INDEX "plugins_health_score_idx" ON "plugins" USING btree ("health_score");
  CREATE INDEX "plugins_category_idx" ON "plugins" USING btree ("category_id");
  CREATE INDEX "plugins_logo_idx" ON "plugins" USING btree ("logo_id");
  CREATE INDEX "plugins_visibility_idx" ON "plugins" USING btree ("visibility");
  CREATE INDEX "plugins_updated_at_idx" ON "plugins" USING btree ("updated_at");
  CREATE INDEX "plugins_created_at_idx" ON "plugins" USING btree ("created_at");
  CREATE INDEX "plugins_deleted_at_idx" ON "plugins" USING btree ("deleted_at");
  CREATE INDEX "plugins_texts_order_parent" ON "plugins_texts" USING btree ("order","parent_id");
  CREATE INDEX "plugins_rels_order_idx" ON "plugins_rels" USING btree ("order");
  CREATE INDEX "plugins_rels_parent_idx" ON "plugins_rels" USING btree ("parent_id");
  CREATE INDEX "plugins_rels_path_idx" ON "plugins_rels" USING btree ("path");
  CREATE INDEX "plugins_rels_tags_id_idx" ON "plugins_rels" USING btree ("tags_id");
  CREATE INDEX "plugins_rels_maintainers_id_idx" ON "plugins_rels" USING btree ("maintainers_id");
  CREATE INDEX "plugins_rels_users_id_idx" ON "plugins_rels" USING btree ("users_id");
  CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");
  CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
  CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "categories" USING btree ("created_at");
  CREATE INDEX "categories_rels_order_idx" ON "categories_rels" USING btree ("order");
  CREATE INDEX "categories_rels_parent_idx" ON "categories_rels" USING btree ("parent_id");
  CREATE INDEX "categories_rels_path_idx" ON "categories_rels" USING btree ("path");
  CREATE INDEX "categories_rels_users_id_idx" ON "categories_rels" USING btree ("users_id");
  CREATE INDEX "categories_rels_maintainers_id_idx" ON "categories_rels" USING btree ("maintainers_id");
  CREATE INDEX "_categories_v_parent_idx" ON "_categories_v" USING btree ("parent_id");
  CREATE INDEX "_categories_v_version_version_parent_idx" ON "_categories_v" USING btree ("version_parent_id");
  CREATE INDEX "_categories_v_version_version_slug_idx" ON "_categories_v" USING btree ("version_slug");
  CREATE INDEX "_categories_v_version_version_updated_at_idx" ON "_categories_v" USING btree ("version_updated_at");
  CREATE INDEX "_categories_v_version_version_created_at_idx" ON "_categories_v" USING btree ("version_created_at");
  CREATE INDEX "_categories_v_created_at_idx" ON "_categories_v" USING btree ("created_at");
  CREATE INDEX "_categories_v_updated_at_idx" ON "_categories_v" USING btree ("updated_at");
  CREATE INDEX "_categories_v_rels_order_idx" ON "_categories_v_rels" USING btree ("order");
  CREATE INDEX "_categories_v_rels_parent_idx" ON "_categories_v_rels" USING btree ("parent_id");
  CREATE INDEX "_categories_v_rels_path_idx" ON "_categories_v_rels" USING btree ("path");
  CREATE INDEX "_categories_v_rels_users_id_idx" ON "_categories_v_rels" USING btree ("users_id");
  CREATE INDEX "_categories_v_rels_maintainers_id_idx" ON "_categories_v_rels" USING btree ("maintainers_id");
  CREATE INDEX "tags__h_tags_idx" ON "tags" USING btree ("_h_tags_id");
  CREATE UNIQUE INDEX "tags_slug_idx" ON "tags" USING btree ("slug");
  CREATE INDEX "tags_updated_at_idx" ON "tags" USING btree ("updated_at");
  CREATE INDEX "tags_created_at_idx" ON "tags" USING btree ("created_at");
  CREATE INDEX "tags_texts_order_parent" ON "tags_texts" USING btree ("order","parent_id");
  CREATE INDEX "tags_rels_order_idx" ON "tags_rels" USING btree ("order");
  CREATE INDEX "tags_rels_parent_idx" ON "tags_rels" USING btree ("parent_id");
  CREATE INDEX "tags_rels_path_idx" ON "tags_rels" USING btree ("path");
  CREATE INDEX "tags_rels_users_id_idx" ON "tags_rels" USING btree ("users_id");
  CREATE INDEX "tags_rels_maintainers_id_idx" ON "tags_rels" USING btree ("maintainers_id");
  CREATE INDEX "_tags_v_parent_idx" ON "_tags_v" USING btree ("parent_id");
  CREATE INDEX "_tags_v_version_version__h_tags_idx" ON "_tags_v" USING btree ("version__h_tags_id");
  CREATE INDEX "_tags_v_version_version_slug_idx" ON "_tags_v" USING btree ("version_slug");
  CREATE INDEX "_tags_v_version_version_updated_at_idx" ON "_tags_v" USING btree ("version_updated_at");
  CREATE INDEX "_tags_v_version_version_created_at_idx" ON "_tags_v" USING btree ("version_created_at");
  CREATE INDEX "_tags_v_created_at_idx" ON "_tags_v" USING btree ("created_at");
  CREATE INDEX "_tags_v_updated_at_idx" ON "_tags_v" USING btree ("updated_at");
  CREATE INDEX "_tags_v_texts_order_parent" ON "_tags_v_texts" USING btree ("order","parent_id");
  CREATE INDEX "_tags_v_rels_order_idx" ON "_tags_v_rels" USING btree ("order");
  CREATE INDEX "_tags_v_rels_parent_idx" ON "_tags_v_rels" USING btree ("parent_id");
  CREATE INDEX "_tags_v_rels_path_idx" ON "_tags_v_rels" USING btree ("path");
  CREATE INDEX "_tags_v_rels_users_id_idx" ON "_tags_v_rels" USING btree ("users_id");
  CREATE INDEX "_tags_v_rels_maintainers_id_idx" ON "_tags_v_rels" USING btree ("maintainers_id");
  CREATE INDEX "submissions_plugin_idx" ON "submissions" USING btree ("plugin_id");
  CREATE INDEX "submissions_submitted_by_idx" ON "submissions" USING btree ("submitted_by_id");
  CREATE INDEX "submissions_updated_at_idx" ON "submissions" USING btree ("updated_at");
  CREATE INDEX "submissions_created_at_idx" ON "submissions" USING btree ("created_at");
  CREATE INDEX "submissions_rels_order_idx" ON "submissions_rels" USING btree ("order");
  CREATE INDEX "submissions_rels_parent_idx" ON "submissions_rels" USING btree ("parent_id");
  CREATE INDEX "submissions_rels_path_idx" ON "submissions_rels" USING btree ("path");
  CREATE INDEX "submissions_rels_users_id_idx" ON "submissions_rels" USING btree ("users_id");
  CREATE INDEX "submissions_rels_maintainers_id_idx" ON "submissions_rels" USING btree ("maintainers_id");
  CREATE INDEX "_submissions_v_parent_idx" ON "_submissions_v" USING btree ("parent_id");
  CREATE INDEX "_submissions_v_version_version_plugin_idx" ON "_submissions_v" USING btree ("version_plugin_id");
  CREATE INDEX "_submissions_v_version_version_submitted_by_idx" ON "_submissions_v" USING btree ("version_submitted_by_id");
  CREATE INDEX "_submissions_v_version_version_updated_at_idx" ON "_submissions_v" USING btree ("version_updated_at");
  CREATE INDEX "_submissions_v_version_version_created_at_idx" ON "_submissions_v" USING btree ("version_created_at");
  CREATE INDEX "_submissions_v_created_at_idx" ON "_submissions_v" USING btree ("created_at");
  CREATE INDEX "_submissions_v_updated_at_idx" ON "_submissions_v" USING btree ("updated_at");
  CREATE INDEX "_submissions_v_rels_order_idx" ON "_submissions_v_rels" USING btree ("order");
  CREATE INDEX "_submissions_v_rels_parent_idx" ON "_submissions_v_rels" USING btree ("parent_id");
  CREATE INDEX "_submissions_v_rels_path_idx" ON "_submissions_v_rels" USING btree ("path");
  CREATE INDEX "_submissions_v_rels_users_id_idx" ON "_submissions_v_rels" USING btree ("users_id");
  CREATE INDEX "_submissions_v_rels_maintainers_id_idx" ON "_submissions_v_rels" USING btree ("maintainers_id");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "media_original_original_filename_idx" ON "media" USING btree ("original_filename");
  CREATE INDEX "media_rels_order_idx" ON "media_rels" USING btree ("order");
  CREATE INDEX "media_rels_parent_idx" ON "media_rels" USING btree ("parent_id");
  CREATE INDEX "media_rels_path_idx" ON "media_rels" USING btree ("path");
  CREATE INDEX "media_rels_users_id_idx" ON "media_rels" USING btree ("users_id");
  CREATE INDEX "media_rels_maintainers_id_idx" ON "media_rels" USING btree ("maintainers_id");
  CREATE INDEX "_media_v_parent_idx" ON "_media_v" USING btree ("parent_id");
  CREATE INDEX "_media_v_version_version_updated_at_idx" ON "_media_v" USING btree ("version_updated_at");
  CREATE INDEX "_media_v_version_version_created_at_idx" ON "_media_v" USING btree ("version_created_at");
  CREATE INDEX "_media_v_version_version_filename_idx" ON "_media_v" USING btree ("version_filename");
  CREATE INDEX "_media_v_version_original_version_original_filename_idx" ON "_media_v" USING btree ("version_original_filename");
  CREATE INDEX "_media_v_created_at_idx" ON "_media_v" USING btree ("created_at");
  CREATE INDEX "_media_v_updated_at_idx" ON "_media_v" USING btree ("updated_at");
  CREATE INDEX "_media_v_rels_order_idx" ON "_media_v_rels" USING btree ("order");
  CREATE INDEX "_media_v_rels_parent_idx" ON "_media_v_rels" USING btree ("parent_id");
  CREATE INDEX "_media_v_rels_path_idx" ON "_media_v_rels" USING btree ("path");
  CREATE INDEX "_media_v_rels_users_id_idx" ON "_media_v_rels" USING btree ("users_id");
  CREATE INDEX "_media_v_rels_maintainers_id_idx" ON "_media_v_rels" USING btree ("maintainers_id");
  CREATE INDEX "directory_settings_rels_order_idx" ON "directory_settings_rels" USING btree ("order");
  CREATE INDEX "directory_settings_rels_parent_idx" ON "directory_settings_rels" USING btree ("parent_id");
  CREATE INDEX "directory_settings_rels_path_idx" ON "directory_settings_rels" USING btree ("path");
  CREATE INDEX "directory_settings_rels_plugins_id_idx" ON "directory_settings_rels" USING btree ("plugins_id");
  CREATE INDEX "directory_settings_rels_users_id_idx" ON "directory_settings_rels" USING btree ("users_id");
  CREATE INDEX "directory_settings_rels_maintainers_id_idx" ON "directory_settings_rels" USING btree ("maintainers_id");
  CREATE INDEX "_directory_settings_v_created_at_idx" ON "_directory_settings_v" USING btree ("created_at");
  CREATE INDEX "_directory_settings_v_updated_at_idx" ON "_directory_settings_v" USING btree ("updated_at");
  CREATE INDEX "_directory_settings_v_rels_order_idx" ON "_directory_settings_v_rels" USING btree ("order");
  CREATE INDEX "_directory_settings_v_rels_parent_idx" ON "_directory_settings_v_rels" USING btree ("parent_id");
  CREATE INDEX "_directory_settings_v_rels_path_idx" ON "_directory_settings_v_rels" USING btree ("path");
  CREATE INDEX "_directory_settings_v_rels_plugins_id_idx" ON "_directory_settings_v_rels" USING btree ("plugins_id");
  CREATE INDEX "_directory_settings_v_rels_users_id_idx" ON "_directory_settings_v_rels" USING btree ("users_id");
  CREATE INDEX "_directory_settings_v_rels_maintainers_id_idx" ON "_directory_settings_v_rels" USING btree ("maintainers_id");
  ALTER TABLE "users_rels" ADD CONSTRAINT "users_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_repositories_fk" FOREIGN KEY ("repositories_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_plugins_fk" FOREIGN KEY ("plugins_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tags_fk" FOREIGN KEY ("tags_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_submissions_fk" FOREIGN KEY ("submissions_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_llm_instructions_rels" ADD CONSTRAINT "payload_llm_instructions_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "users_rels_maintainers_id_idx" ON "users_rels" USING btree ("maintainers_id");
  CREATE INDEX "payload_locked_documents_rels_maintainers_id_idx" ON "payload_locked_documents_rels" USING btree ("maintainers_id");
  CREATE INDEX "payload_locked_documents_rels_repositories_id_idx" ON "payload_locked_documents_rels" USING btree ("repositories_id");
  CREATE INDEX "payload_locked_documents_rels_plugins_id_idx" ON "payload_locked_documents_rels" USING btree ("plugins_id");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_tags_id_idx" ON "payload_locked_documents_rels" USING btree ("tags_id");
  CREATE INDEX "payload_locked_documents_rels_submissions_id_idx" ON "payload_locked_documents_rels" USING btree ("submissions_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_preferences_rels_maintainers_id_idx" ON "payload_preferences_rels" USING btree ("maintainers_id");
  CREATE INDEX "payload_llm_instructions_rels_maintainers_id_idx" ON "payload_llm_instructions_rels" USING btree ("maintainers_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "repository_snapshots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "plugin_snapshots" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "maintainers" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "maintainers_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_maintainers_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_maintainers_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "repositories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "repositories_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "repositories_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "plugins_payload_majors" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "plugins" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "plugins_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "plugins_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "categories_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_categories_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_categories_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tags" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tags_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "tags_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_tags_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_tags_v_texts" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_tags_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "submissions" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "submissions_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_submissions_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_submissions_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "media" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "media_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_media_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_media_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "directory_settings" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "directory_settings_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_directory_settings_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_directory_settings_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "repository_snapshots" CASCADE;
  DROP TABLE "plugin_snapshots" CASCADE;
  DROP TABLE "maintainers" CASCADE;
  DROP TABLE "maintainers_rels" CASCADE;
  DROP TABLE "_maintainers_v" CASCADE;
  DROP TABLE "_maintainers_v_rels" CASCADE;
  DROP TABLE "repositories" CASCADE;
  DROP TABLE "repositories_texts" CASCADE;
  DROP TABLE "repositories_rels" CASCADE;
  DROP TABLE "plugins_payload_majors" CASCADE;
  DROP TABLE "plugins" CASCADE;
  DROP TABLE "plugins_texts" CASCADE;
  DROP TABLE "plugins_rels" CASCADE;
  DROP TABLE "categories" CASCADE;
  DROP TABLE "categories_rels" CASCADE;
  DROP TABLE "_categories_v" CASCADE;
  DROP TABLE "_categories_v_rels" CASCADE;
  DROP TABLE "tags" CASCADE;
  DROP TABLE "tags_texts" CASCADE;
  DROP TABLE "tags_rels" CASCADE;
  DROP TABLE "_tags_v" CASCADE;
  DROP TABLE "_tags_v_texts" CASCADE;
  DROP TABLE "_tags_v_rels" CASCADE;
  DROP TABLE "submissions" CASCADE;
  DROP TABLE "submissions_rels" CASCADE;
  DROP TABLE "_submissions_v" CASCADE;
  DROP TABLE "_submissions_v_rels" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "media_rels" CASCADE;
  DROP TABLE "_media_v" CASCADE;
  DROP TABLE "_media_v_rels" CASCADE;
  DROP TABLE "directory_settings" CASCADE;
  DROP TABLE "directory_settings_rels" CASCADE;
  DROP TABLE "_directory_settings_v" CASCADE;
  DROP TABLE "_directory_settings_v_rels" CASCADE;
  ALTER TABLE "users_rels" DROP CONSTRAINT "users_rels_maintainers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_maintainers_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_repositories_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_plugins_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_categories_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_tags_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_submissions_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_media_fk";
  
  ALTER TABLE "payload_preferences_rels" DROP CONSTRAINT "payload_preferences_rels_maintainers_fk";
  
  ALTER TABLE "payload_llm_instructions_rels" DROP CONSTRAINT "payload_llm_instructions_rels_maintainers_fk";
  
  DROP INDEX "users_rels_maintainers_id_idx";
  DROP INDEX "payload_locked_documents_rels_maintainers_id_idx";
  DROP INDEX "payload_locked_documents_rels_repositories_id_idx";
  DROP INDEX "payload_locked_documents_rels_plugins_id_idx";
  DROP INDEX "payload_locked_documents_rels_categories_id_idx";
  DROP INDEX "payload_locked_documents_rels_tags_id_idx";
  DROP INDEX "payload_locked_documents_rels_submissions_id_idx";
  DROP INDEX "payload_locked_documents_rels_media_id_idx";
  DROP INDEX "payload_preferences_rels_maintainers_id_idx";
  DROP INDEX "payload_llm_instructions_rels_maintainers_id_idx";
  ALTER TABLE "users_rels" DROP COLUMN "maintainers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "maintainers_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "repositories_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "plugins_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "categories_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "tags_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "submissions_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "media_id";
  ALTER TABLE "payload_preferences_rels" DROP COLUMN "maintainers_id";
  ALTER TABLE "payload_llm_instructions_rels" DROP COLUMN "maintainers_id";
  DROP TYPE "public"."enum_plugins_payload_majors";
  DROP TYPE "public"."enum_plugins_source";
  DROP TYPE "public"."enum_plugins_visibility";
  DROP TYPE "public"."enum_tags_created_by";
  DROP TYPE "public"."enum__tags_v_version_created_by";
  DROP TYPE "public"."enum_submissions_type";
  DROP TYPE "public"."enum_submissions_status";
  DROP TYPE "public"."enum__submissions_v_version_type";
  DROP TYPE "public"."enum__submissions_v_version_status";`)
}
