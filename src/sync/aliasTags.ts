export type AliasTag = { id: number; aliases?: string[] | null }

const norm = (s: string) => s.trim().toLowerCase()

/** Tags whose aliases match any GitHub topic or npm keyword (case-insensitive), sorted by id. */
export function aliasTagIds(terms: readonly string[], tags: readonly AliasTag[]): number[] {
  const wanted = new Set(terms.map(norm).filter(Boolean))
  return tags
    .filter((t) => (t.aliases ?? []).some((a) => wanted.has(norm(a))))
    .map((t) => t.id)
    .sort((a, b) => a - b)
}

/** Union of existing tag ids (ids or populated docs) and new ones. Sync only adds tags; it never removes one. */
export function mergeTagIds(existing: readonly (number | { id: number })[] | null | undefined, add: readonly number[]): number[] {
  const ids = new Set((existing ?? []).map((t) => (typeof t === 'object' ? t.id : t)))
  for (const id of add) ids.add(id)
  return [...ids].sort((a, b) => a - b)
}
