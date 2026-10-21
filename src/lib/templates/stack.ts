import type { PackageJson } from '@/types'

export const STACKS = ['nextjs', 'tanstack-start', 'other'] as const
export type StackValue = (typeof STACKS)[number]

const LABELS: Record<StackValue, string> = { nextjs: 'Next.js', 'tanstack-start': 'TanStack Start', other: 'Other' }

export const stackLabel = (v: StackValue): string => LABELS[v]

/** Stack from the template's package.json: `dependencies`, then `devDependencies`. Neither package present: 'other'. */
export function detectStack(pkg: PackageJson | null): StackValue {
  for (const deps of [pkg?.dependencies, pkg?.devDependencies]) {
    if (!deps) continue
    if (Object.hasOwn(deps, '@payloadcms/next')) return 'nextjs'
    if (Object.hasOwn(deps, '@payloadcms/tanstack-start')) return 'tanstack-start'
  }
  return 'other'
}

/** An admin or owner override wins over the detected stack. */
export function effectiveStack(doc: { stackDetected?: StackValue | null; stackOverride?: StackValue | null }): StackValue {
  return doc.stackOverride ?? doc.stackDetected ?? 'other'
}
