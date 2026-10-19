import { describe, expect, it } from 'vitest'
import * as stats from '@/app/(site)/stats/page'

describe('stats page', () => {
  it('renders per request with its own canonical and og:url', () => {
    expect(stats.dynamic).toBe('force-dynamic')
    expect(stats.metadata.alternates?.canonical).toBe('/stats')
    expect(stats.metadata.openGraph?.url).toBe('/stats')
  })
})
