import { describe, expect, it } from 'vitest'
import { runtimeEnvWarnings } from '@/lib/runtimeEnv'

const prod = {
  NODE_ENV: 'production', SERVER_URL: 'https://payloaddirectory.dev', REVALIDATE_SECRET: 'a-long-random-secret-value-0123456789',
  GITHUB_TOKEN: 't', INTERNAL_WEB_URL: 'http://web:3000',
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
})
