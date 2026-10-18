import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "_maintainers_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_maintainers_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_media_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_media_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_directory_settings_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_directory_settings_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "_maintainers_v" CASCADE;
  DROP TABLE "_maintainers_v_rels" CASCADE;
  DROP TABLE "_media_v" CASCADE;
  DROP TABLE "_media_v_rels" CASCADE;
  DROP TABLE "_directory_settings_v" CASCADE;
  DROP TABLE "_directory_settings_v_rels" CASCADE;
  ALTER TABLE "repositories" ADD COLUMN "github_created_at" timestamp(3) with time zone;
  CREATE INDEX "repositories_created_at_idx" ON "repositories" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
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
  
  DROP INDEX "repositories_created_at_idx";
  ALTER TABLE "_maintainers_v" ADD CONSTRAINT "_maintainers_v_parent_id_maintainers_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."maintainers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_maintainers_v_rels" ADD CONSTRAINT "_maintainers_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_maintainers_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_maintainers_v_rels" ADD CONSTRAINT "_maintainers_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_maintainers_v_rels" ADD CONSTRAINT "_maintainers_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v" ADD CONSTRAINT "_media_v_parent_id_media_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_media_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_media_v_rels" ADD CONSTRAINT "_media_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_directory_settings_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_plugins_fk" FOREIGN KEY ("plugins_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_directory_settings_v_rels" ADD CONSTRAINT "_directory_settings_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
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
  CREATE INDEX "_directory_settings_v_created_at_idx" ON "_directory_settings_v" USING btree ("created_at");
  CREATE INDEX "_directory_settings_v_updated_at_idx" ON "_directory_settings_v" USING btree ("updated_at");
  CREATE INDEX "_directory_settings_v_rels_order_idx" ON "_directory_settings_v_rels" USING btree ("order");
  CREATE INDEX "_directory_settings_v_rels_parent_idx" ON "_directory_settings_v_rels" USING btree ("parent_id");
  CREATE INDEX "_directory_settings_v_rels_path_idx" ON "_directory_settings_v_rels" USING btree ("path");
  CREATE INDEX "_directory_settings_v_rels_plugins_id_idx" ON "_directory_settings_v_rels" USING btree ("plugins_id");
  CREATE INDEX "_directory_settings_v_rels_users_id_idx" ON "_directory_settings_v_rels" USING btree ("users_id");
  CREATE INDEX "_directory_settings_v_rels_maintainers_id_idx" ON "_directory_settings_v_rels" USING btree ("maintainers_id");
  ALTER TABLE "repositories" DROP COLUMN "github_created_at";`)
}
