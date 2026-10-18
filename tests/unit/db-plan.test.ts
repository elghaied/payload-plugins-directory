import { describe, expect, it } from 'vitest'
import { assertConfirmed, isLocalDatabaseUrl, planPull, planPush, recoveryInfo, shq, type DbEnv } from '../../scripts/db/plan'

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
    expect(steps.find((s) => s.label === 'restore')!.cmd).toMatch(/pg_restore .*--clean --if-exists .*--single-transaction --exit-on-error/)
  })
  it('skips worker steps when no worker container is configured', () => {
    const noWorker = { ...env, containers: { ...env.containers, staging: { db: 'stg-db', web: 'stg-web' } } }
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
    expect(steps.map((s) => s.label)).toEqual(['dump remote', 'copy dump', 'cleanup remote', 'restore local'])
    const remote = steps.filter((s) => s.where === 'remote').map((s) => s.cmd).join('\n')
    expect(remote).not.toMatch(/pg_restore|DROP|truncate/i)
  })
})

describe('planPush hardening', () => {
  const opts = { target: 'production' as const, env, withMedia: false, stamp: 's1' }
  const steps = planPush(opts)
  const labels = steps.map((s) => s.label)

  it('always migrates and restarts web, and throws without a web container', () => {
    expect(labels).toContain('migrate')
    expect(labels).toContain('restart web')
    const noWeb = { ...env, containers: { ...env.containers, production: { db: 'prod-db' } } }
    expect(() => planPush({ ...opts, env: noWeb })).toThrow(/web container/)
  })
  it('cleans up the remote dump last', () => {
    expect(labels.at(-1)).toBe('cleanup')
    expect(steps.at(-1)!.cmd).toMatch(/^rm -f .*directory-local-s1\.dump/)
  })
  it('writes every dump under umask 077 and keeps the local dir private', () => {
    for (const l of ['dump local', 'backup target']) {
      expect(steps.find((s) => s.label === l)!.cmd).toMatch(/^umask 077 && /)
    }
    expect(steps.find((s) => s.label === 'dump local')!.cmd).toContain('mkdir -p -m 700 .db-dumps')
  })
  it('passes a URL with $ and " intact inside single quotes', () => {
    const url = 'postgresql://u:p$w"d@localhost:5433/directory'
    const cmd = planPush({ ...opts, env: { ...env, localUrl: url } }).find((s) => s.label === 'dump local')!.cmd
    expect(cmd).toContain(`-d '${url}'`)
  })
})

describe('recoveryInfo', () => {
  it('gives the backup path and a manual restore command for the target db', () => {
    const r = recoveryInfo({ target: 'production', env, stamp: 's1' })
    expect(r.backupFile).toBe('/root/directory-backups/production-before-push-s1.dump')
    expect(r.restoreCmd).toContain('docker exec -i prod-db pg_restore')
    expect(r.restoreCmd).toContain('--single-transaction')
    expect(r.restoreCmd).toContain(r.backupFile)
  })
})

describe('isLocalDatabaseUrl', () => {
  it.each([
    ['postgresql://d:d@localhost:5433/directory', true],
    ['postgresql://d:d@127.0.0.1:5432/directory', true],
    ['postgresql://d:d@[::1]:5432/directory', true],
    ['postgresql://d:d@db.example.com/directory?host=localhost', false],
    ['postgresql://localhost:x@db.example.com/directory', false],
    ['postgresql://d:d@localhost.evil.com/directory', false],
    ['not a url', false],
    ['', false],
  ])('%s -> %s', (url, expected) => {
    expect(isLocalDatabaseUrl(url)).toBe(expected)
  })
})

describe('shq', () => {
  it('escapes embedded single quotes', () => {
    expect(shq("a'b")).toBe("'a'\\''b'")
  })
})
