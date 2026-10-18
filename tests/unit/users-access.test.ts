import { describe, expect, it, vi } from 'vitest'
import { Users } from '@/collections/Users'

const req = (user: unknown) => ({ req: { user } }) as never
const ops = ['read', 'create', 'update', 'delete'] as const
const rule = (op: (typeof ops)[number]) => Users.access![op] as (a: never) => unknown

describe('Users access', () => {
  for (const op of ops) {
    it(`${op}: denies maintainers and anonymous, allows admin users`, () => {
      expect(rule(op)(req({ id: 1, collection: 'maintainers' }))).toBe(false)
      expect(rule(op)(req(null))).toBe(false)
      expect(rule(op)(req({ id: 1, collection: 'users' }))).toBe(true)
    })
  }
})

describe('Users auth cookie', () => {
  it('is Secure only in production builds', async () => {
    const load = async (nodeEnv: string) => {
      vi.resetModules()
      vi.stubEnv('NODE_ENV', nodeEnv)
      const { Users: u } = await import('@/collections/Users')
      return (u.auth as { cookies?: { secure?: boolean } }).cookies?.secure
    }
    expect(await load('production')).toBe(true)
    expect(await load('development')).toBe(false)
    vi.unstubAllEnvs()
  })
})
