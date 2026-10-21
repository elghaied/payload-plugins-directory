import { describe, expect, it } from 'vitest'
import { maintainerMayUseApiPath } from '@/lib/auth/strategy'

describe('maintainerMayUseApiPath', () => {
  it.each(['/', '/me', '/submit', '/admin', '/api/plugins', '/API/Plugins/3', '/api/plugins/3', '/api/submissions', '/api/submissions/9'])('allows %s', (p) => {
    expect(maintainerMayUseApiPath(p)).toBe(true)
  })
  it.each(['/api/payload-preferences/x', '/api/payload-preferences', '/api/graphql', '/api/media', '/api/templates', '/api/templates/1', '/API/Templates/1', '/api/maintainers/me', '/api/pluginsx', '/api//plugins', '/API/payload-preferences/x', '/Api/graphql', '/api'])('refuses %s', (p) => {
    expect(maintainerMayUseApiPath(p)).toBe(false)
  })
})
