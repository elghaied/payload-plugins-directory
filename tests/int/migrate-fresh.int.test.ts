import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, it } from 'vitest'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { getTestPayload } from './helpers/payload'

const run = promisify(execFile)
const SCRATCH = 'directory_fresh_migrate_test'

/**
 * Production, CI and every new dev environment start from an empty database: every migration, including the data
 * migration that seeds taxonomy through the Local API (and so fires plugin-search hooks before `search` exists), must
 * apply from zero. Runs the real `payload migrate` CLI against a scratch `_test` database, then drops it.
 */
describe('migrations from an empty database', () => {
  it('applies every migration, including search_index, on a brand-new database', async () => {
    const payload = await getTestPayload()
    const url = new URL(process.env.DATABASE_URL_TEST as string)
    url.pathname = `/${SCRATCH}`
    await payload.db.drizzle.execute(sql.raw(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`))
    await payload.db.drizzle.execute(sql.raw(`CREATE DATABASE ${SCRATCH}`))
    try {
      const { stdout, stderr } = await run('pnpm', ['payload', 'migrate'], {
        env: { ...process.env, DATABASE_URL: url.toString(), ANTHROPIC_API_KEY: '' },
        timeout: 150_000,
      })
      const out = stdout + stderr
      expect(out).toContain('Migrated:  20261021_011329_search_index')
      expect(out).toContain('Migrated:  20261021_013801_search_resync_task')
      expect(out).toContain('Migrated:  20261021_034401_readme_truncated')
      expect(out).toContain('Migrated:  20261021_070342_readme_html')
      expect(out).not.toMatch(/relation "search" does not exist/)
    } finally {
      await payload.db.drizzle.execute(sql.raw(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`))
    }
  }, 180_000)
})
