import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_plugins_sync_trash_reason" AS ENUM('repository-gone', 'package-removed');
  CREATE TABLE "job_status" (
  	"key" text PRIMARY KEY NOT NULL,
  	"last_success_at" timestamp with time zone,
  	"last_failure_at" timestamp with time zone,
  	"last_error" text,
  	"details" jsonb,
  	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "plugins" ADD COLUMN "sync_trash_reason" "enum_plugins_sync_trash_reason";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "job_status" CASCADE;
  ALTER TABLE "plugins" DROP COLUMN "sync_trash_reason";
  DROP TYPE "public"."enum_plugins_sync_trash_reason";`)
}
