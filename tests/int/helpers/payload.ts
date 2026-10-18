import { getPayload, type Migration, type Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { migrations } from '@/migrations'

let instance: Payload | undefined

/** Payload bound to DATABASE_URL_TEST, migrated once per test process. */
export async function getTestPayload(): Promise<Payload> {
  if (instance) return instance
  process.env.DATABASE_URL = process.env.DATABASE_URL_TEST
  const { default: config } = await import('@payload-config')
  instance = await getPayload({ config: await config })
  // Pass the migrations explicitly: Payload's own file loader uses a native import()
  // under Vitest, which cannot strip the generated files' non-`type` imports.
  await instance.db.migrate({ migrations: migrations as unknown as Migration[] })
  return instance
}

/** Truncates every table except Payload's migration bookkeeping. */
export async function resetDatabase(payload: Payload): Promise<void> {
  const result = await payload.db.drizzle.execute(sql`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'payload_migrations'
  `)
  const tables = (result.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`)
  if (tables.length) {
    await payload.db.drizzle.execute(sql.raw(`truncate ${tables.join(', ')} restart identity cascade`))
  }
}
