import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sql } from '@payloadcms/db-postgres/drizzle'
import type { Payload } from 'payload'
import { getTestPayload, resetDatabase } from './helpers/payload'
import { repositorySnapshots } from '@/db/snapshots'

let payload: Payload
beforeAll(async () => {
  payload = await getTestPayload()
  await resetDatabase(payload)
})
afterAll(async () => resetDatabase(payload))

describe('snapshot tables', () => {
  it('upserts one row per repository per day', async () => {
    const row = { repositoryId: 1, date: '2026-10-18', stars: 10, forks: 1, openIssues: 0 }
    const db = payload.db.drizzle
    await db.insert(repositorySnapshots).values(row)
    await db
      .insert(repositorySnapshots)
      .values({ ...row, stars: 12 })
      .onConflictDoUpdate({ target: [repositorySnapshots.repositoryId, repositorySnapshots.date], set: { stars: 12 } })
    const result = await db.execute(sql`select stars from repository_snapshots`)
    expect(result.rows).toEqual([{ stars: 12 }])
  })
})
