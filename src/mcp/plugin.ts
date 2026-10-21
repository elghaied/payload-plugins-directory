import { mcpPlugin, type MCPPluginConfig } from '@payloadcms/plugin-mcp'
import type { Plugin } from 'payload'
import { publicReadOnlyMCP } from './access'
import { MCP_MAX_BODY_BYTES, mcpGuardPlugin } from './guard'
import { SERVER_INSTRUCTIONS } from './instructions'
import { comparePluginsTool, getPluginTool, listCategoriesTool, searchPluginsTool } from './tools'

/** Every non-`payload-*` collection. Tests fail if a collection is added without being listed here. */
export const APP_COLLECTIONS = ['users', 'maintainers', 'repositories', 'plugins', 'categories', 'tags', 'submissions', 'media', 'search'] as const

// All built-ins in plugin-mcp 4.0.0-beta.3 (src: dist/mcp/builtinTools.js). Several write
// (create, update, delete, duplicate, restoreVersion; update/restoreGlobalVersion on globals).
const COLLECTION_BUILTINS = ['count', 'countVersions', 'create', 'delete', 'duplicate', 'find', 'findDistinct', 'findVersionByID', 'findVersions', 'getCollectionSchema', 'getUploadInstructions', 'restoreVersion', 'update'] as const
const GLOBAL_BUILTINS = ['countGlobalVersions', 'find', 'findGlobalVersionByID', 'findGlobalVersions', 'getGlobalSchema', 'restoreGlobalVersion', 'update'] as const
const allOff = (keys: readonly string[]) => Object.fromEntries(keys.map((k) => [k, false]))

/** The anonymous, read-only MCP endpoint (POST /api/mcp), wrapped by the one-call/size/no-store guard. */
export const directoryMcpPlugin = (): Plugin[] => [
  mcpPlugin({
    // Belt: no built-in tool exists for any app collection or the global.
    collections: Object.fromEntries(APP_COLLECTIONS.map((slug) => [slug, { tools: allOff(COLLECTION_BUILTINS) }])) as MCPPluginConfig['collections'],
    globals: { 'directory-settings': { tools: allOff(GLOBAL_BUILTINS) } } as MCPPluginConfig['globals'],
    tools: {
      searchPlugins: searchPluginsTool,
      getPlugin: getPluginTool,
      listCategories: listCategoriesTool,
      comparePlugins: comparePluginsTool,
    },
    // Braces: every caller is anonymous and sees only the four tools above (also hides payload-* collections).
    overrideGetAuthorizedMCP: publicReadOnlyMCP,
    mcp: {
      maxRequestBodySize: MCP_MAX_BODY_BYTES,
      serverOptions: {
        serverInfo: { name: 'payload-plugin-directory', version: '1.0.0' },
        options: { instructions: SERVER_INSTRUCTIONS },
      },
    },
  }),
  mcpGuardPlugin(),
]
