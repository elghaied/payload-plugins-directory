import { describe, expect, it } from 'vitest'
import { clock, duration, relativeTime } from '@/components/admin/format'
import { nameFromEmail } from '@/components/admin/WelcomeWidget'

const NOW = new Date('2026-10-22T12:00:00Z')

describe('dashboard formatting', () => {
  it('relative times', () => {
    expect(relativeTime(new Date(NOW.getTime() + 14 * 60_000).toISOString(), NOW)).toBe('in 14 min')
    expect(relativeTime(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW)).toBe('3 h ago')
    expect(relativeTime(new Date(NOW.getTime() - 5_000).toISOString(), NOW)).toBe('just now')
    expect(relativeTime(null, NOW)).toBe('–')
  })
  it('durations and clock times', () => {
    expect(duration(640)).toBe('640 ms')
    expect(duration(4200)).toBe('4.2 s')
    expect(duration(290_000)).toBe('4 min 50 s')
    expect(duration(null)).toBe('–')
    expect(clock('2026-10-22T00:15:00Z', NOW)).toBe('00:15 UTC')
    expect(clock('2026-10-23T00:15:00Z', NOW)).toBe('10-23 00:15 UTC')
  })
  it('a first name from the admin email, only when it looks like one', () => {
    expect(nameFromEmail('sam.e@example.com')).toBe('Sam')
    expect(nameFromEmail('x1@example.com')).toBeNull()
    expect(nameFromEmail(undefined)).toBeNull()
  })
})
