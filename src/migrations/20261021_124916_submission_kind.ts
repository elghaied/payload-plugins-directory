import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_submissions_kind" AS ENUM('plugin', 'template');
  CREATE TYPE "public"."enum__submissions_v_version_kind" AS ENUM('plugin', 'template');
  ALTER TABLE "submissions" ADD COLUMN "kind" "enum_submissions_kind" DEFAULT 'plugin';
  ALTER TABLE "submissions" ADD COLUMN "path" varchar;
  ALTER TABLE "submissions" ADD COLUMN "template_id" integer;
  ALTER TABLE "_submissions_v" ADD COLUMN "version_kind" "enum__submissions_v_version_kind" DEFAULT 'plugin';
  ALTER TABLE "_submissions_v" ADD COLUMN "version_path" varchar;
  ALTER TABLE "_submissions_v" ADD COLUMN "version_template_id" integer;
  ALTER TABLE "submissions" ADD CONSTRAINT "submissions_template_id_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_submissions_v" ADD CONSTRAINT "_submissions_v_version_template_id_templates_id_fk" FOREIGN KEY ("version_template_id") REFERENCES "public"."templates"("id") ON DELETE set null ON UPDATE no action;
  CREATE INDEX "submissions_kind_idx" ON "submissions" USING btree ("kind");
  CREATE INDEX "submissions_template_idx" ON "submissions" USING btree ("template_id");
  CREATE INDEX "_submissions_v_version_version_kind_idx" ON "_submissions_v" USING btree ("version_kind");
  CREATE INDEX "_submissions_v_version_version_template_idx" ON "_submissions_v" USING btree ("version_template_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "submissions" DROP CONSTRAINT "submissions_template_id_templates_id_fk";
  
  ALTER TABLE "_submissions_v" DROP CONSTRAINT "_submissions_v_version_template_id_templates_id_fk";
  
  DROP INDEX "submissions_kind_idx";
  DROP INDEX "submissions_template_idx";
  DROP INDEX "_submissions_v_version_version_kind_idx";
  DROP INDEX "_submissions_v_version_version_template_idx";
  ALTER TABLE "submissions" DROP COLUMN "kind";
  ALTER TABLE "submissions" DROP COLUMN "path";
  ALTER TABLE "submissions" DROP COLUMN "template_id";
  ALTER TABLE "_submissions_v" DROP COLUMN "version_kind";
  ALTER TABLE "_submissions_v" DROP COLUMN "version_path";
  ALTER TABLE "_submissions_v" DROP COLUMN "version_template_id";
  DROP TYPE "public"."enum_submissions_kind";
  DROP TYPE "public"."enum__submissions_v_version_kind";`)
}
