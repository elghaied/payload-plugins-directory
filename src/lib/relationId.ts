/** Id of a relationship value, whether it is populated (`{ id }`) or a bare id. */
export function relationId(value: unknown): number | undefined {
  if (typeof value === 'number') return value
  if (typeof value === 'object' && value !== null && typeof (value as { id?: unknown }).id === 'number') {
    return (value as { id: number }).id
  }
  return undefined
}
