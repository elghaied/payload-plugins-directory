/** Decoded catch-all segments, or null when one is not a single path segment (a "/" or "%2F" inside it, or bad encoding). */
export function segmentsOf(path: string[]): string[] | null {
  const out: string[] = []
  for (const raw of path) {
    let seg: string
    try {
      seg = decodeURIComponent(raw)
    } catch {
      return null
    }
    if (!seg || seg.includes('/')) return null
    out.push(seg)
  }
  return out
}
