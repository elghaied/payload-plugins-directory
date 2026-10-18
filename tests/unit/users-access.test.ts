import { describe, expect, it } from 'vitest'
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
