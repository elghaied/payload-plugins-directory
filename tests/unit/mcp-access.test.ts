import { describe, expect, it } from 'vitest'
import { PUBLIC_MCP_TOOLS, publicReadOnlyMCP } from '@/mcp/access'

const item = (type: string, mcpName: string, extra: Record<string, unknown> = {}) => ({ type, mcpName, configKey: mcpName, label: mcpName, ...extra })
const items = [
  ...PUBLIC_MCP_TOOLS.map((n) => item('tool', n, { tool: {} })),
  item('tool', 'getConfigInfo', { tool: {} }),
  item('collectionTool', 'createDocuments', { collectionSlug: 'plugins', tool: {} }),
  item('collectionTool', 'findDocuments', { collectionSlug: 'users', tool: {} }),
  item('collectionTool', 'deleteDocuments', { collectionSlug: 'payload-jobs', tool: {} }),
  item('globalTool', 'updateGlobal', { globalSlug: 'directory-settings', tool: {} }),
  item('prompt', 'somePrompt', { prompt: {} }),
]

describe('publicReadOnlyMCP', () => {
  it('forces an anonymous, access-controlled caller and exposes only the public tools', async () => {
    const req = { user: { id: 1, collection: 'users' } }
    const result = await publicReadOnlyMCP({ overrideAccess: true, pluginConfig: { items } as never, req: req as never })
    expect(req.user).toBeNull()
    expect(result.overrideAccess).toBe(false)
    expect(result.items.map((i) => i.mcpName).sort()).toEqual([...PUBLIC_MCP_TOOLS].sort())
  })
})
