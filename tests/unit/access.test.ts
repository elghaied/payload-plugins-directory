import { describe, expect, it } from 'vitest'
import { anyone, isAdmin, isAdminUser } from '@/access'

const req = (user: unknown) => ({ req: { user } }) as never

describe('access helpers', () => {
  it('isAdmin allows users collection', () => {
    expect(isAdmin(req({ id: 1, collection: 'users' }))).toBe(true)
  })
  it('isAdmin denies maintainers and anonymous', () => {
    expect(isAdmin(req({ id: 1, collection: 'maintainers' }))).toBe(false)
    expect(isAdmin(req(null))).toBe(false)
  })
  it('anyone allows anonymous', () => {
    expect(anyone(req(null))).toBe(true)
  })
  it('isAdminUser checks the collection', () => {
    expect(isAdminUser({ collection: 'users' })).toBe(true)
    expect(isAdminUser({ collection: 'maintainers' })).toBe(false)
    expect(isAdminUser(undefined)).toBe(false)
  })
})
