import { describe, expect, it } from 'vitest'
import * as trending from '@/app/(site)/trending/page'

describe('trending page', () => {
  it('renders per request with its own canonical and og:url', () => {
    expect(trending.dynamic).toBe('force-dynamic')
    expect(trending.metadata.alternates?.canonical).toBe('/trending')
    expect(trending.metadata.openGraph?.url).toBe('/trending')
  })
})
