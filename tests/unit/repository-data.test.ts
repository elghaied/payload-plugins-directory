import { describe, expect, it } from 'vitest'
import { toRepositoryData } from '@/sync/syncRepository'
import { ghRepo } from '../fixtures/sync/github'

describe('toRepositoryData', () => {
  it("stores the About → Website field, trimmed; empty or oversized values become null", () => {
    const now = new Date('2026-10-22T00:00:00Z')
    expect(toRepositoryData(ghRepo(1, 'a/b', { homepage: ' https://demo.dev ' }), false, now).homepage).toBe('https://demo.dev')
    expect(toRepositoryData(ghRepo(1, 'a/b', { homepage: '' }), false, now).homepage).toBeNull()
    expect(toRepositoryData(ghRepo(1, 'a/b', { homepage: `https://x.dev/${'a'.repeat(600)}` }), false, now).homepage).toBeNull()
    expect(toRepositoryData(ghRepo(1, 'a/b'), false, now).homepage).toBeNull()
  })
})
