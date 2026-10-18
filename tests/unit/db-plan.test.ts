import { describe, expect, it } from 'vitest'
import { assertConfirmed, planPull, planPush, type DbEnv } from '../../scripts/db/plan'

const env: DbEnv = {
  sshHost: 'kawlya',
  dbName: 'directory',
  dbUser: 'directory',
  localUrl: 'postgresql://directory:directory@localhost:5433/directory',
  containers: {
    staging: { db: 'stg-db', worker: 'stg-worker', web: 'stg-web' },
    production: { db: 'prod-db', worker: 'prod-worker', web: 'prod-web' },
  },
}

describe('assertConfirmed', () => {
  it('accepts the exact target name', () => {
    expect(() => assertConfirmed('production', 'production')).not.toThrow()
  })
  it.each(['', 'prod', 'Production', 'staging', ' production'])('rejects %j', (typed) => {
    expect(() => assertConfirmed('production', typed)).toThrow(/aborted/i)
  })
})

describe('planPush', () => {
  const steps = planPush({ target: 'production', env, withMedia: false, stamp: '20261018-1200' })
  const labels = steps.map((s) => s.label)

  it('backs up the target before anything destructive', () => {
    expect(labels.indexOf('backup target')).toBeLessThan(labels.indexOf('restore'))
    expect(labels[0]).toBe('dump local')
  })
  it('stops the worker before restore and starts it after', () => {
    expect(labels.indexOf('stop worker')).toBeLessThan(labels.indexOf('restore'))
    expect(labels.indexOf('start worker')).toBeGreaterThan(labels.indexOf('migrate'))
  })
  it('targets only the chosen environment containers', () => {
    const remote = steps.filter((s) => s.where === 'remote').map((s) => s.cmd).join('\n')
    expect(remote).toContain('prod-db')
    expect(remote).not.toContain('stg-db')
  })
  it('restores with --clean --if-exists', () => {
    expect(steps.find((s) => s.label === 'restore')!.cmd).toMatch(/pg_restore .*--clean --if-exists/)
  })
  it('skips worker steps when no worker container is configured', () => {
    const noWorker = { ...env, containers: { ...env.containers, staging: { db: 'stg-db' } } }
    const l = planPush({ target: 'staging', env: noWorker, withMedia: false, stamp: 's' }).map((s) => s.label)
    expect(l).not.toContain('stop worker')
  })
  it('adds media sync only when requested', () => {
    expect(labels).not.toContain('sync media')
    expect(planPush({ target: 'production', env, withMedia: true, stamp: 's' }).map((s) => s.label)).toContain('sync media')
  })
})

describe('planPull', () => {
  it('dumps remote then restores locally, never touching remote data', () => {
    const steps = planPull({ target: 'production', env, withMedia: false, stamp: 's' })
    expect(steps.map((s) => s.label)).toEqual(['dump remote', 'copy dump', 'restore local'])
    const remote = steps.filter((s) => s.where === 'remote').map((s) => s.cmd).join('\n')
    expect(remote).not.toMatch(/pg_restore|DROP|truncate/i)
  })
})
