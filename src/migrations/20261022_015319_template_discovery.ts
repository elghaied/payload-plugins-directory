import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_submissions_origin" AS ENUM('user', 'discovery');
  CREATE TYPE "public"."enum__submissions_v_version_origin" AS ENUM('user', 'discovery');
  ALTER TYPE "public"."enum_templates_source" ADD VALUE 'topic';
  ALTER TABLE "submissions" ALTER COLUMN "submitted_by_id" DROP NOT NULL;
  ALTER TABLE "_submissions_v" ALTER COLUMN "version_submitted_by_id" DROP NOT NULL;
  ALTER TABLE "submissions" ADD COLUMN "origin" "enum_submissions_origin" DEFAULT 'user';
  ALTER TABLE "_submissions_v" ADD COLUMN "version_origin" "enum__submissions_v_version_origin" DEFAULT 'user';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  // Rows the old schema cannot hold: topic-listed templates become submissions; discovery suggestions (no submitter) go.
  await db.execute(sql`
   UPDATE "templates" SET "source" = 'submission' WHERE "source" = 'topic';
  DELETE FROM "_submissions_v" WHERE "version_submitted_by_id" IS NULL;
  DELETE FROM "submissions" WHERE "submitted_by_id" IS NULL;
   ALTER TABLE "templates" ALTER COLUMN "source" SET DATA TYPE text;
  ALTER TABLE "templates" ALTER COLUMN "source" SET DEFAULT 'submission'::text;
  DROP TYPE "public"."enum_templates_source";
  CREATE TYPE "public"."enum_templates_source" AS ENUM('official', 'submission', 'converted');
  ALTER TABLE "templates" ALTER COLUMN "source" SET DEFAULT 'submission'::"public"."enum_templates_source";
  ALTER TABLE "templates" ALTER COLUMN "source" SET DATA TYPE "public"."enum_templates_source" USING "source"::"public"."enum_templates_source";
  ALTER TABLE "submissions" ALTER COLUMN "submitted_by_id" SET NOT NULL;
  ALTER TABLE "_submissions_v" ALTER COLUMN "version_submitted_by_id" SET NOT NULL;
  ALTER TABLE "submissions" DROP COLUMN "origin";
  ALTER TABLE "_submissions_v" DROP COLUMN "version_origin";
  DROP TYPE "public"."enum_submissions_origin";
  DROP TYPE "public"."enum__submissions_v_version_origin";`)
}
