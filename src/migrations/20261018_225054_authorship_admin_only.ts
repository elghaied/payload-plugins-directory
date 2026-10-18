import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  // authorship: false on plugins/repositories — drop their createdBy/updatedBy relation rows first so
  // no orphaned rows (with every target column null) are left behind in plugins_rels.
  await db.execute(sql`
   DELETE FROM "plugins_rels" WHERE "path" IN ('createdBy', 'updatedBy');
   ALTER TABLE "repositories_rels" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "repositories_rels" CASCADE;
  ALTER TABLE "plugins_rels" DROP CONSTRAINT "plugins_rels_users_fk";
  
  DROP INDEX "plugins_rels_users_id_idx";
  ALTER TABLE "plugins_rels" DROP COLUMN "users_id";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "repositories_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"maintainers_id" integer
  );
  
  ALTER TABLE "plugins_rels" ADD COLUMN "users_id" integer;
  ALTER TABLE "repositories_rels" ADD CONSTRAINT "repositories_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "repositories_rels" ADD CONSTRAINT "repositories_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "repositories_rels" ADD CONSTRAINT "repositories_rels_maintainers_fk" FOREIGN KEY ("maintainers_id") REFERENCES "public"."maintainers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "repositories_rels_order_idx" ON "repositories_rels" USING btree ("order");
  CREATE INDEX "repositories_rels_parent_idx" ON "repositories_rels" USING btree ("parent_id");
  CREATE INDEX "repositories_rels_path_idx" ON "repositories_rels" USING btree ("path");
  CREATE INDEX "repositories_rels_users_id_idx" ON "repositories_rels" USING btree ("users_id");
  CREATE INDEX "repositories_rels_maintainers_id_idx" ON "repositories_rels" USING btree ("maintainers_id");
  ALTER TABLE "plugins_rels" ADD CONSTRAINT "plugins_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "plugins_rels_users_id_idx" ON "plugins_rels" USING btree ("users_id");`)
}
