import type { Payload } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'
import { pluginSnapshots, repositorySnapshots } from '@/db/snapshots'
import { relId } from './util'

export type SnapshotResult = { date: string; repositories: number; plugins: number }

const CHUNK = 1000
const chunks = <T>(rows: T[]): T[][] => Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) => rows.slice(i * CHUNK, (i + 1) * CHUNK))

/** Today's (UTC) rows in both snapshot tables; a same-day re-run overwrites instead of duplicating (spec §3.2). */
export async function runSnapshot(payload: Payload, now: Date): Promise<SnapshotResult> {
  const date = now.toISOString().slice(0, 10)
  const plugins = (
    await payload.find({ collection: 'plugins', overrideAccess: true, depth: 0, limit: 0, pagination: false, select: { repository: true, npm: true, healthScore: true } })
  ).docs
  const repoIds = [...new Set(plugins.map((p) => relId(p.repository)).filter((id): id is number => id !== null))]
  const repos = repoIds.length
    ? (
        await payload.find({
          collection: 'repositories', overrideAccess: true, depth: 0, limit: 0, pagination: false,
          where: { id: { in: repoIds } }, select: { stars: true, forks: true, openIssues: true },
        })
      ).docs
    : []

  const db = payload.db.drizzle
  for (const rows of chunks(repos.map((r) => ({ repositoryId: r.id, date, stars: r.stars ?? 0, forks: r.forks ?? 0, openIssues: r.openIssues ?? 0 })))) {
    await db.insert(repositorySnapshots).values(rows).onConflictDoUpdate({
      target: [repositorySnapshots.repositoryId, repositorySnapshots.date],
      set: { stars: sql`excluded.stars`, forks: sql`excluded.forks`, openIssues: sql`excluded.open_issues` },
    })
  }
  for (const rows of chunks(plugins.map((p) => ({ pluginId: p.id, date, weeklyDownloads: p.npm?.weeklyDownloads ?? null, healthScore: p.healthScore ?? null })))) {
    await db.insert(pluginSnapshots).values(rows).onConflictDoUpdate({
      target: [pluginSnapshots.pluginId, pluginSnapshots.date],
      set: { weeklyDownloads: sql`excluded.weekly_downloads`, healthScore: sql`excluded.health_score` },
    })
  }
  return { date, repositories: repos.length, plugins: plugins.length }
}
