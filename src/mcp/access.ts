import type { MCPPluginConfig } from '@payloadcms/plugin-mcp'

export const PUBLIC_MCP_TOOLS = ['searchPlugins', 'getPlugin', 'listCategories', 'comparePlugins', 'getTemplate'] as const

/**
 * Replaces plugin-mcp's resolver. The endpoint is public and read-only:
 * - every caller is anonymous (`req.user = null`), whatever `Authorization` header or cookie it sends;
 * - `overrideAccess` is always false, even when `?overrideAccess=true` is accepted in development;
 * - only the five custom read-only tools exist; built-in CRUD/version/global tools never do.
 */
export const publicReadOnlyMCP: NonNullable<MCPPluginConfig['overrideGetAuthorizedMCP']> = ({ pluginConfig, req }) => {
  req.user = null
  return {
    items: pluginConfig.items.filter((item) => item.type === 'tool' && (PUBLIC_MCP_TOOLS as readonly string[]).includes(item.mcpName)),
    overrideAccess: false,
  }
}
