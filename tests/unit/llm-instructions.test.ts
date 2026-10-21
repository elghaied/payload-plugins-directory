import { describe, expect, it, vi } from 'vitest'
import {
  CATEGORIES_LLM_INSTRUCTIONS,
  CATEGORIES_TOOL_INSTRUCTIONS,
  mcpUrl,
  PLUGINS_LLM_INSTRUCTIONS,
  SERVER_INSTRUCTIONS,
  UNTRUSTED_NOTICE,
} from '@/mcp/instructions'

describe('LLM instructions', () => {
  it('explain health score, version ranges and AI fields for plugins', () => {
    for (const term of ['healthScore', 'payloadMajors', 'payloadVersionRange', 'ai', 'untrusted']) {
      expect(PLUGINS_LLM_INSTRUCTIONS).toContain(term)
    }
  })
  it('explain the category tree', () => {
    expect(CATEGORIES_LLM_INSTRUCTIONS).toContain('other')
    expect(CATEGORIES_LLM_INSTRUCTIONS).toContain('Uncategorized')
  })
  it('the listCategories tool text names the `path` output field, not the stored _h_slugPath', () => {
    expect(CATEGORIES_TOOL_INSTRUCTIONS).toContain('`path`')
    expect(CATEGORIES_TOOL_INSTRUCTIONS).not.toContain('_h_slugPath')
    expect(CATEGORIES_LLM_INSTRUCTIONS).toContain('_h_slugPath')
  })
  it('server instructions carry the untrusted-content warning and list the tools', () => {
    expect(SERVER_INSTRUCTIONS).toContain(UNTRUSTED_NOTICE)
    for (const tool of ['searchPlugins', 'getPlugin', 'listCategories', 'comparePlugins']) expect(SERVER_INSTRUCTIONS).toContain(tool)
    expect(SERVER_INSTRUCTIONS).toMatch(/^Payload Directory:/)
    expect(SERVER_INSTRUCTIONS).not.toContain('Plugin Directory')
  })
  it('keeps host names out of the server instructions and builds the MCP URL from SERVER_URL', () => {
    expect(SERVER_INSTRUCTIONS).not.toMatch(/https?:\/\/|\.dev\b/)
    vi.stubEnv('SERVER_URL', 'https://example.test')
    expect(mcpUrl()).toBe('https://example.test/api/mcp')
    vi.unstubAllEnvs()
  })
})
