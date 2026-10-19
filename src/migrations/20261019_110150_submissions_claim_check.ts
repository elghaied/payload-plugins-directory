import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "submissions" ADD COLUMN "last_claim_check_at" timestamp(3) with time zone;
  ALTER TABLE "_submissions_v" ADD COLUMN "version_last_claim_check_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "submissions" DROP COLUMN "last_claim_check_at";
  ALTER TABLE "_submissions_v" DROP COLUMN "version_last_claim_check_at";`)
}
