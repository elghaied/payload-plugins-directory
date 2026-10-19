import { describe, expect, it } from 'vitest'
import * as about from '@/app/(site)/about/page'

describe('about page', () => {
  it('renders per request with its own canonical and og:url (no build-time host)', () => {
    expect(about.dynamic).toBe('force-dynamic')
    expect(about.metadata.alternates?.canonical).toBe('/about')
    expect(about.metadata.openGraph?.url).toBe('/about')
  })
})
