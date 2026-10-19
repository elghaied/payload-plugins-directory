/** Id of a relationship value at any depth. */
export const relId = (v: number | { id: number } | null | undefined): number | null =>
  v == null ? null : typeof v === 'object' ? v.id : v

/** Same point in time, whatever the ISO formatting ("…Z" from GitHub vs "….000Z" from Payload). */
export const sameInstant = (a?: string | null, b?: string | null): boolean =>
  Boolean(a && b && Date.parse(a) === Date.parse(b))

/** Same set of ids, order-insensitive. */
export function sameIds(a: readonly number[], b: readonly (number | { id: number })[] | null | undefined): boolean {
  const x = [...a].sort((p, q) => p - q)
  const y = (b ?? []).map((v) => (typeof v === 'object' ? v.id : v)).sort((p, q) => p - q)
  return x.length === y.length && x.every((v, i) => v === y[i])
}
