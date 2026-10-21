import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as mcpPage from '@/app/(site)/mcp/page'
import { PUBLIC_MCP_TOOLS } from '@/mcp/plugin'

describe('/mcp page', () => {
  beforeEach(() => vi.stubEnv('SERVER_URL', 'https://dir.example'))
  afterEach(() => vi.unstubAllEnvs())

  it('renders per request with its own canonical and og:url (no build-time host)', () => {
    expect(mcpPage.dynamic).toBe('force-dynamic')
    expect(mcpPage.metadata.alternates?.canonical).toBe('/mcp')
    expect(mcpPage.metadata.openGraph?.url).toBe('/mcp')
  })

  it('documents every public tool and builds each client setup from the runtime endpoint', () => {
    const html = renderToStaticMarkup(createElement(mcpPage.default))
    for (const name of Object.keys(PUBLIC_MCP_TOOLS)) expect(html).toContain(`>${name}</code>`)
    expect(html).toContain('claude mcp add --transport http payload-directory https://dir.example/api/mcp')
    expect(html).toContain('&quot;servers&quot;') // VS Code
    expect(html).toContain('mcp-remote')
    expect(html).not.toContain('localhost')
  })
})
