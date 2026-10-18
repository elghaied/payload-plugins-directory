import { getPayload, type Migration, type Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { migrations } from '@/migrations'
import { assertTestDatabaseUrl } from './assertTestDatabaseUrl'

// IMPORTANT: tests must obtain Payload only through getTestPayload() and must never
// statically import `@payload-config` / `src/payload.config.ts`. The config reads
// DATABASE_URL when it is first evaluated, so it has to be imported dynamically
// *after* DATABASE_URL has been pointed at the test database below.

let instance: Payload | undefined

/** Payload bound to DATABASE_URL_TEST, migrated once per test process. */
export async function getTestPayload(): Promise<Payload> {
  if (instance) return instance
  process.env.DATABASE_URL = assertTestDatabaseUrl(process.env.DATABASE_URL_TEST, process.env.DATABASE_URL)
  const { default: config } = await import('@payload-config')
  instance = await getPayload({ config: await config })
  // Pass the migrations explicitly: Payload's own file loader uses a native import()
  // under Vitest, which cannot strip the generated files' non-`type` imports.
  await instance.db.migrate({ migrations: migrations as unknown as Migration[] })
  return instance
}

/** Truncates every table except Payload's migration bookkeeping. Only runs on a `_test` database. */
export async function resetDatabase(payload: Payload): Promise<void> {
  const current = await payload.db.drizzle.execute(sql`select current_database() as name`)
  const name = (current.rows[0] as { name: string } | undefined)?.name ?? ''
  if (!name.endsWith('_test')) {
    throw new Error(`resetDatabase refused: connected database "${name}" does not end in "_test".`)
  }
  const result = await payload.db.drizzle.execute(sql`
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'payload_migrations'
  `)
  const tables = (result.rows as { tablename: string }[]).map((r) => `"${r.tablename}"`)
  if (tables.length) {
    await payload.db.drizzle.execute(sql.raw(`truncate ${tables.join(', ')} restart identity cascade`))
  }
}
