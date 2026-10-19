import { describe, expect, it } from 'vitest'
import { runtimeEnvWarnings } from '@/lib/runtimeEnv'

const prod = {
  NODE_ENV: 'production', SERVER_URL: 'https://payloaddirectory.dev', REVALIDATE_SECRET: 'a-long-random-secret-value-0123456789',
  GITHUB_TOKEN: 't', INTERNAL_WEB_URL: 'http://web:3000', ANTHROPIC_API_KEY: 'k',
  SESSION_SECRET: 'a-long-session-secret-0123456789abcdef', GITHUB_OAUTH_CLIENT_ID: 'id', GITHUB_OAUTH_CLIENT_SECRET: 'secret',
}

describe('runtimeEnvWarnings', () => {
  it('stays quiet outside production', () => {
    expect(runtimeEnvWarnings({ NODE_ENV: 'development' }, 'web')).toEqual([])
  })
  it('stays quiet for a complete production configuration', () => {
    expect(runtimeEnvWarnings(prod, 'web')).toEqual([])
    expect(runtimeEnvWarnings(prod, 'worker')).toEqual([])
  })
  it('warns that a missing SERVER_URL empties allowed origins and noindexes the site', () => {
    expect(runtimeEnvWarnings({ ...prod, SERVER_URL: '' }, 'web')).toEqual([expect.stringMatching(/SERVER_URL is not set.*noindex/)])
  })
  it('mentions the cross-origin check for the web process only', () => {
    expect(runtimeEnvWarnings({ ...prod, SERVER_URL: '' }, 'web')[0]).toMatch(/cross-origin/)
    expect(runtimeEnvWarnings({ ...prod, SERVER_URL: '' }, 'worker')[0]).not.toMatch(/cross-origin/)
  })
  it('warns when SERVER_URL is not the production host', () => {
    expect(runtimeEnvWarnings({ ...prod, SERVER_URL: 'https://next.payloaddirectory.dev' }, 'web')).toEqual([
      expect.stringMatching(/next\.payloaddirectory\.dev.*noindex/),
    ])
  })
  it('warns about a missing REVALIDATE_SECRET in both roles', () => {
    expect(runtimeEnvWarnings({ ...prod, REVALIDATE_SECRET: undefined }, 'web')).toEqual([expect.stringMatching(/REVALIDATE_SECRET/)])
    expect(runtimeEnvWarnings({ ...prod, REVALIDATE_SECRET: undefined }, 'worker')).toEqual([expect.stringMatching(/REVALIDATE_SECRET/)])
  })
  it('warns about a short REVALIDATE_SECRET without logging its value', () => {
    const w = runtimeEnvWarnings({ ...prod, REVALIDATE_SECRET: 'hunter2' }, 'web')
    expect(w).toEqual([expect.stringMatching(/REVALIDATE_SECRET.*shorter/)])
    expect(w.join(' ')).not.toContain('hunter2')
  })
  it('warns only the worker about GITHUB_TOKEN and INTERNAL_WEB_URL', () => {
    expect(runtimeEnvWarnings({ ...prod, GITHUB_TOKEN: '', INTERNAL_WEB_URL: undefined }, 'worker')).toEqual([
      expect.stringMatching(/GITHUB_TOKEN/),
      expect.stringMatching(/INTERNAL_WEB_URL/),
    ])
    expect(runtimeEnvWarnings({ ...prod, GITHUB_TOKEN: '', INTERNAL_WEB_URL: undefined }, 'web')).toEqual([])
  })
  it('warns only the worker about a missing ANTHROPIC_API_KEY', () => {
    expect(runtimeEnvWarnings({ ...prod, ANTHROPIC_API_KEY: '' }, 'worker')).toEqual([expect.stringMatching(/ANTHROPIC_API_KEY/)])
    expect(runtimeEnvWarnings({ ...prod, ANTHROPIC_API_KEY: '' }, 'web')).toEqual([])
  })
  it('warns only the web process about a missing or short SESSION_SECRET without logging it', () => {
    expect(runtimeEnvWarnings({ ...prod, SESSION_SECRET: undefined }, 'web')).toEqual([expect.stringMatching(/SESSION_SECRET is not set/)])
    const w = runtimeEnvWarnings({ ...prod, SESSION_SECRET: 'hunter2' }, 'web')
    expect(w).toEqual([expect.stringMatching(/SESSION_SECRET.*shorter/)])
    expect(w.join(' ')).not.toContain('hunter2')
    expect(runtimeEnvWarnings({ ...prod, SESSION_SECRET: undefined }, 'worker')).toEqual([])
  })
  it('warns only the web process about missing OAuth credentials', () => {
    expect(runtimeEnvWarnings({ ...prod, GITHUB_OAUTH_CLIENT_ID: '' }, 'web')).toEqual([expect.stringMatching(/GITHUB_OAUTH_CLIENT_ID/)])
    expect(runtimeEnvWarnings({ ...prod, GITHUB_OAUTH_CLIENT_SECRET: undefined }, 'web')).toEqual([expect.stringMatching(/GITHUB_OAUTH_CLIENT_SECRET/)])
    expect(runtimeEnvWarnings({ ...prod, GITHUB_OAUTH_CLIENT_ID: '' }, 'worker')).toEqual([])
  })
})
