import { describe, expect, it } from 'vitest'
import { detectStack, effectiveStack, stackLabel } from '@/lib/templates/stack'

describe('template stack', () => {
  it('detects the stack from dependencies', () => {
    expect(detectStack({ dependencies: { '@payloadcms/next': 'workspace:*' } })).toBe('nextjs')
    expect(detectStack({ devDependencies: { '@payloadcms/tanstack-start': '1.0.0' } })).toBe('tanstack-start')
    expect(detectStack({})).toBe('other')
    expect(detectStack(null)).toBe('other')
  })
  it('prefers the override', () => {
    expect(effectiveStack({ stackDetected: 'nextjs', stackOverride: 'other' })).toBe('other')
    expect(effectiveStack({ stackDetected: 'nextjs' })).toBe('nextjs')
    expect(effectiveStack({})).toBe('other')
    expect(stackLabel('tanstack-start')).toBe('TanStack Start')
  })
})
