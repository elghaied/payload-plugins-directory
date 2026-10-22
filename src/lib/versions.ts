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

const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const MAX_VERSION_CHARS = 64

/** `value` when it is an exact semver version (e.g. "4.0.0-beta.4"), else null. */
export function exactVersion(value: unknown): string | null {
  return typeof value === 'string' && value.length <= MAX_VERSION_CHARS && EXACT_VERSION.test(value) ? value : null
}

/**
 * Payload majors a plugin supports. A `workspace:` range (official monorepo packages) counts the major of the
 * package's latest npm version and, for `workspace:<version>`, the major of the version on the monorepo's default
 * branch: while v4 is in beta, npm `latest` is 3.x and `main` is 4.x, and both are supported releases.
 */
export function payloadMajorsFromRange(
  range: string | null,
  latestNpmVersion?: string | null,
): PayloadMajor[] {
  if (!range) return ['unknown']
  const sources = range.startsWith('workspace:')
    ? [latestNpmVersion, exactVersion(range.slice('workspace:'.length))]
    : [range]
  const majors = new Set(sources.flatMap((s) => (s ? extractMajorVersions(s) : [])).filter((m) => KNOWN_MAJORS.has(m)))
  return majors.size ? ([...majors].sort((a, b) => a - b).map(String) as PayloadMajor[]) : ['unknown']
}
