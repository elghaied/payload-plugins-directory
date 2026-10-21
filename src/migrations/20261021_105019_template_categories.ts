import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "template_categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"intro" varchar,
  	"icon" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "template_categories_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  CREATE TABLE "_template_categories_v" (
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
  
  CREATE TABLE "_template_categories_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "template_categories_id" integer;
  ALTER TABLE "template_categories" ADD CONSTRAINT "template_categories_parent_id_template_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."template_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "template_categories_rels" ADD CONSTRAINT "template_categories_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."template_categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "template_categories_rels" ADD CONSTRAINT "template_categories_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "template_categories_rels" ADD CONSTRAINT "template_categories_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_template_categories_v" ADD CONSTRAINT "_template_categories_v_parent_id_template_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."template_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_template_categories_v" ADD CONSTRAINT "_template_categories_v_version_parent_id_template_categories_id_fk" FOREIGN KEY ("version_parent_id") REFERENCES "public"."template_categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_template_categories_v_rels" ADD CONSTRAINT "_template_categories_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_template_categories_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_template_categories_v_rels" ADD CONSTRAINT "_template_categories_v_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_template_categories_v_rels" ADD CONSTRAINT "_template_categories_v_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "template_categories_parent_idx" ON "template_categories" USING btree ("parent_id");
  CREATE UNIQUE INDEX "template_categories_slug_idx" ON "template_categories" USING btree ("slug");
  CREATE INDEX "template_categories_updated_at_idx" ON "template_categories" USING btree ("updated_at");
  CREATE INDEX "template_categories_created_at_idx" ON "template_categories" USING btree ("created_at");
  CREATE INDEX "template_categories_rels_order_idx" ON "template_categories_rels" USING btree ("order");
  CREATE INDEX "template_categories_rels_parent_idx" ON "template_categories_rels" USING btree ("parent_id");
  CREATE INDEX "template_categories_rels_path_idx" ON "template_categories_rels" USING btree ("path");
  CREATE INDEX "template_categories_rels_users_id_idx" ON "template_categories_rels" USING btree ("users_id");
  CREATE INDEX "template_categories_rels_maintainers_id_idx" ON "template_categories_rels" USING btree ("maintainers_id");
  CREATE INDEX "_template_categories_v_parent_idx" ON "_template_categories_v" USING btree ("parent_id");
  CREATE INDEX "_template_categories_v_version_version_parent_idx" ON "_template_categories_v" USING btree ("version_parent_id");
  CREATE INDEX "_template_categories_v_version_version_slug_idx" ON "_template_categories_v" USING btree ("version_slug");
  CREATE INDEX "_template_categories_v_version_version_updated_at_idx" ON "_template_categories_v" USING btree ("version_updated_at");
  CREATE INDEX "_template_categories_v_version_version_created_at_idx" ON "_template_categories_v" USING btree ("version_created_at");
  CREATE INDEX "_template_categories_v_created_at_idx" ON "_template_categories_v" USING btree ("created_at");
  CREATE INDEX "_template_categories_v_updated_at_idx" ON "_template_categories_v" USING btree ("updated_at");
  CREATE INDEX "_template_categories_v_rels_order_idx" ON "_template_categories_v_rels" USING btree ("order");
  CREATE INDEX "_template_categories_v_rels_parent_idx" ON "_template_categories_v_rels" USING btree ("parent_id");
  CREATE INDEX "_template_categories_v_rels_path_idx" ON "_template_categories_v_rels" USING btree ("path");
  CREATE INDEX "_template_categories_v_rels_users_id_idx" ON "_template_categories_v_rels" USING btree ("users_id");
  CREATE INDEX "_template_categories_v_rels_maintainers_id_idx" ON "_template_categories_v_rels" USING btree ("maintainers_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_template_categories_fk" FOREIGN KEY ("template_categories_id") REFERENCES "public"."template_categories"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_template_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("template_categories_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "template_categories" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "template_categories_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_template_categories_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_template_categories_v_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "template_categories" CASCADE;
  DROP TABLE "template_categories_rels" CASCADE;
  DROP TABLE "_template_categories_v" CASCADE;
  DROP TABLE "_template_categories_v_rels" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_template_categories_fk";
  
  DROP INDEX "payload_locked_documents_rels_template_categories_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "template_categories_id";`)
}
