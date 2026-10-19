import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'enrich';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'enrich-all';
  ALTER TYPE "public"."enum_payload_jobs_log_task_slug" ADD VALUE 'enrich-batch';
  ALTER TYPE "public"."enum_payload_jobs_log_parent_task_slug" ADD VALUE 'enrich';
  ALTER TYPE "public"."enum_payload_jobs_log_parent_task_slug" ADD VALUE 'enrich-all';
  ALTER TYPE "public"."enum_payload_jobs_log_parent_task_slug" ADD VALUE 'enrich-batch';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'enrich';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'enrich-all';
  ALTER TYPE "public"."enum_payload_jobs_task_slug" ADD VALUE 'enrich-batch';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_task_slug" AS ENUM('inline', 'discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_task_slug" USING "task_slug"::"public"."enum_payload_jobs_log_task_slug";
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "parent_task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_log_parent_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_log_parent_task_slug" AS ENUM('inline', 'discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate');
  ALTER TABLE "payload_jobs_log" ALTER COLUMN "parent_task_slug" SET DATA TYPE "public"."enum_payload_jobs_log_parent_task_slug" USING "parent_task_slug"::"public"."enum_payload_jobs_log_parent_task_slug";
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_payload_jobs_task_slug";
  CREATE TYPE "public"."enum_payload_jobs_task_slug" AS ENUM('inline', 'discover', 'sync-repository', 'npm-stats', 'snapshot', 'revalidate');
  ALTER TABLE "payload_jobs" ALTER COLUMN "task_slug" SET DATA TYPE "public"."enum_payload_jobs_task_slug" USING "task_slug"::"public"."enum_payload_jobs_task_slug";`)
}
