export type PayloadMajor = '1' | '2' | '3' | '4' | 'unknown'

const KNOWN_MAJORS = new Set([1, 2, 3, 4])

/** Major versions referenced by an npm semver range, e.g. "^2.0.0 || ^3.0.0" -> [2, 3]. */
export function extractMajorVersions(range: string): number[] {
  const majors = new Set<number>()
  for (const part of range.split('||')) {
    const match = part.replace(/[\^~>=<\s]/g, '').match(/^(\d+)/)
    if (match) majors.add(Number.parseInt(match[1], 10))
  }
  return [...majors].sort((a, b) => a - b)
}

/**
 * Payload majors a plugin supports. `workspace:*` (official monorepo packages)
 * falls back to the major of the package's latest npm version.
 */
export function payloadMajorsFromRange(
  range: string | null,
  latestNpmVersion?: string | null,
): PayloadMajor[] {
  if (!range) return ['unknown']
  const source = range.startsWith('workspace:') ? latestNpmVersion : range
  if (!source) return ['unknown']
  const majors = extractMajorVersions(source).filter((m) => KNOWN_MAJORS.has(m))
  return majors.length ? (majors.map(String) as PayloadMajor[]) : ['unknown']
}
