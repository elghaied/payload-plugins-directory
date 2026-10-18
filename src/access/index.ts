import type { Access } from 'payload'

export function isAdminUser(user: unknown): boolean {
  return typeof user === 'object' && user !== null && (user as { collection?: string }).collection === 'users'
}

export const isAdmin: Access = ({ req }) => isAdminUser(req.user)
// Structurally typed so it fits both collection/global `Access` and field-level `FieldAccess`.
export const adminOnly = ({ req }: { req: { user?: unknown } }): boolean => isAdminUser(req.user)
export const anyone: Access = () => true
