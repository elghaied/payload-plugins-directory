import { describe, expect, it } from 'vitest'
import { repositoryChanged, toRepositoryData } from '@/sync/syncRepository'
import { ghRepo } from '../fixtures/sync/github'

describe('toRepositoryData', () => {
  it("stores the About → Website field, trimmed; empty or oversized values become null", () => {
    const now = new Date('2026-10-22T00:00:00Z')
    expect(toRepositoryData(ghRepo(1, 'a/b', { homepage: ' https://demo.dev ' }), false, now).homepage).toBe('https://demo.dev')
    expect(toRepositoryData(ghRepo(1, 'a/b', { homepage: '' }), false, now).homepage).toBeNull()
    expect(toRepositoryData(ghRepo(1, 'a/b', { homepage: `https://x.dev/${'a'.repeat(600)}` }), false, now).homepage).toBeNull()
    expect(toRepositoryData(ghRepo(1, 'a/b'), false, now).homepage).toBeNull()
  })
  it('counts a new or changed Website as a change, so existing repositories get it on their next sync', () => {
    const now = new Date('2026-10-22T00:00:00Z')
    const before = toRepositoryData(ghRepo(1, 'a/b'), false, now)
    const prev = { ...before, id: 1, homepage: null, updatedAt: '', createdAt: '' } as never
    expect(repositoryChanged(prev, before)).toBe(false)
    expect(repositoryChanged(prev, toRepositoryData(ghRepo(1, 'a/b', { homepage: 'https://demo.dev' }), false, now))).toBe(true)
  })
})
