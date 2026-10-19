import { daysBetween, utcDay, type Day } from './days'
import { growthOverWindow, type Growth, type Point } from './growth'
import type { DownloadMover, ListedPluginRef, NewPlugin, PluginLink, RecentRepo, StarMover } from './types'

/** Fastest-growing lists ignore +1 noise: a mover needs at least this many new stars / downloads. */
export const MIN_GROWTH_DELTA = 2

const cmp = (a: string, b: string) => a.localeCompare(b, 'en')
const byName = (a: { name: string; slug: string }, b: { name: string; slug: string }) =>
  cmp(a.name, b.name) || cmp(a.slug, b.slug)

function compareGrowth(a: Growth, b: Growth, aName: string, bName: string): number {
  if (b.delta !== a.delta) return b.delta - a.delta
  const ap = a.pct ?? -Infinity
  const bp = b.pct ?? -Infinity
  if (bp !== ap) return bp > ap ? 1 : -1
  return cmp(aName, bName)
}

function groupByRepository(refs: ListedPluginRef[]): Map<number, ListedPluginRef[]> {
  const out = new Map<number, ListedPluginRef[]>()
  for (const ref of refs) {
    const list = out.get(ref.repository.id) ?? []
    list.push(ref)
    out.set(ref.repository.id, list)
  }
  for (const list of out.values()) list.sort(byName)
  return out
}

const links = (refs: ListedPluginRef[]): PluginLink[] => refs.map((r) => ({ slug: r.slug, name: r.name }))

/** Only repositories that back at least one listed plugin can appear (refs are the visibility filter). */
export function rankStarGrowth(
  refs: ListedPluginRef[],
  seriesByRepo: Map<number, Point[]>,
  asOf: Day | null,
  limit = 10,
): StarMover[] {
  if (!asOf) return []
  const out: StarMover[] = []
  for (const [repositoryId, plugins] of groupByRepository(refs)) {
    const growth = growthOverWindow(seriesByRepo.get(repositoryId) ?? [], asOf)
    if (!growth || growth.delta < MIN_GROWTH_DELTA) continue
    const repo = plugins[0].repository
    out.push({ repositoryId, fullName: repo.fullName, owner: repo.owner, ownerAvatar: repo.ownerAvatar, plugins: links(plugins), growth })
  }
  return out.sort((a, b) => compareGrowth(a.growth, b.growth, a.fullName, b.fullName) || cmp(a.plugins[0].slug, b.plugins[0].slug)).slice(0, limit)
}

export function rankDownloadGrowth(
  refs: ListedPluginRef[],
  seriesByPlugin: Map<number, Point[]>,
  asOf: Day | null,
  limit = 10,
): DownloadMover[] {
  if (!asOf) return []
  const out: DownloadMover[] = []
  for (const ref of refs) {
    const growth = growthOverWindow(seriesByPlugin.get(ref.id) ?? [], asOf)
    if (!growth || growth.delta < MIN_GROWTH_DELTA) continue
    out.push({
      pluginId: ref.id, slug: ref.slug, name: ref.name,
      owner: ref.repository.owner, ownerAvatar: ref.repository.ownerAvatar, growth,
    })
  }
  return out.sort((a, b) => compareGrowth(a.growth, b.growth, a.name, b.name) || cmp(a.slug, b.slug)).slice(0, limit)
}

/**
 * New = the GitHub repository was created within `windowDays`, or the plugin was first listed after
 * the directory's first day (the seed day: every seeded plugin shares it, so they are not "new").
 */
/** A first-seen day with more plugins than this is a bulk import (e.g. a seed straddling UTC midnight), not "new". */
export const BULK_IMPORT_MIN_PLUGINS = 10
export const BULK_IMPORT_SHARE = 0.05

export function newThisMonth(refs: ListedPluginRef[], today: Day, windowDays = 30, limit = 12): NewPlugin[] {
  const seenDays = refs.flatMap((r) => (r.firstSeenAt ? [utcDay(r.firstSeenAt)] : [])).sort()
  const seedDay = seenDays[0] ?? null
  const perDay = new Map<Day, number>()
  for (const d of seenDays) perDay.set(d, (perDay.get(d) ?? 0) + 1)
  const bulkLimit = Math.max(BULK_IMPORT_MIN_PLUGINS, BULK_IMPORT_SHARE * refs.length)
  const isBulkDay = (day: Day) => (perDay.get(day) ?? 0) > bulkLimit
  const inWindow = (day: Day) => {
    const age = daysBetween(day, today)
    return age >= 0 && age <= windowDays
  }
  const out: NewPlugin[] = []
  for (const ref of refs) {
    const candidates: { day: Day; reason: NewPlugin['reason'] }[] = []
    if (ref.repository.githubCreatedAt) {
      const day = utcDay(ref.repository.githubCreatedAt)
      if (inWindow(day)) candidates.push({ day, reason: 'new-repository' })
    }
    if (ref.firstSeenAt && seedDay) {
      const day = utcDay(ref.firstSeenAt)
      if (day > seedDay && inWindow(day) && !isBulkDay(day)) candidates.push({ day, reason: 'newly-listed' })
    }
    const best = candidates.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))[0]
    if (!best) continue
    out.push({
      slug: ref.slug, name: ref.name, owner: ref.repository.owner, ownerAvatar: ref.repository.ownerAvatar,
      addedOn: best.day, reason: best.reason,
    })
  }
  return out
    .sort((a, b) => (a.addedOn < b.addedOn ? 1 : a.addedOn > b.addedOn ? -1 : byName(a, b)))
    .slice(0, limit)
}

export function recentlyUpdated(refs: ListedPluginRef[], limit = 12): RecentRepo[] {
  const out: RecentRepo[] = []
  for (const plugins of groupByRepository(refs).values()) {
    const repo = plugins[0].repository
    if (!repo.pushedAt || Number.isNaN(Date.parse(repo.pushedAt))) continue
    out.push({ fullName: repo.fullName, owner: repo.owner, ownerAvatar: repo.ownerAvatar, pushedAt: repo.pushedAt, plugins: links(plugins) })
  }
  return out
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt) || cmp(a.fullName, b.fullName))
    .slice(0, limit)
}
