import type { Payload } from 'payload'
import { pluginSnapshots, repositorySnapshots } from '@/db/snapshots'
import { addDays } from '@/lib/trends/days'

export async function clearSnapshots(payload: Payload): Promise<void> {
  await payload.db.drizzle.delete(repositorySnapshots)
  await payload.db.drizzle.delete(pluginSnapshots)
}

/** values[i] is the value on start + i days. */
export function daily(start: string, values: (number | null)[]) {
  return values.map((value, i) => ({ date: addDays(start, i), value }))
}

export async function insertRepoSnapshots(payload: Payload, repositoryId: number, rows: { date: string; value: number | null }[]) {
  if (!rows.length) return
  await payload.db.drizzle
    .insert(repositorySnapshots)
    .values(rows.map((r) => ({ repositoryId, date: r.date, stars: r.value ?? 0, forks: 0, openIssues: 0 })))
}

export async function insertPluginSnapshots(payload: Payload, pluginId: number, rows: { date: string; value: number | null }[]) {
  if (!rows.length) return
  await payload.db.drizzle
    .insert(pluginSnapshots)
    .values(rows.map((r) => ({ pluginId, date: r.date, weeklyDownloads: r.value, healthScore: null })))
}
