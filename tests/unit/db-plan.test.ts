import { describe, expect, it } from 'vitest'
import {
  assertConfirmed,
  checkTargetContainers,
  describeTarget,
  isLocalDatabaseUrl,
  parseLocalDatabaseUrl,
  REVALIDATE_ALL_SCRIPT,
  planPull,
  planPush,
  recoveryInfo,
  shq,
  type DbEnv,
  verifyTargetStep,
} from '../../scripts/db/plan'

const env: DbEnv = {
  sshHost: 'kawlya',
  dbName: 'directory',
  dbUser: 'directory',
  localUrl: 'postgresql://directory:directory@localhost:5433/directory',
  containers: {
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
    expect(labels.slice(0, 2)).toEqual(['verify target', 'dump local'])
  })
  it('stops the worker before restore and starts it after', () => {
    expect(labels.indexOf('stop worker')).toBeLessThan(labels.indexOf('restore'))
    expect(labels.indexOf('start worker')).toBeGreaterThan(labels.indexOf('migrate'))
  })
  it('targets only the chosen environment containers', () => {
    const remote = steps.filter((s) => s.where === 'remote').map((s) => s.cmd).join('\n')
    expect(remote).toContain('prod-db')
    expect(remote).not.toContain('stg-')
  })
  it('restores with --clean --if-exists', () => {
    expect(steps.find((s) => s.label === 'restore')!.cmd).toMatch(/pg_restore .*--clean --if-exists .*--single-transaction --exit-on-error/)
  })
  it('skips worker steps when no worker container is configured', () => {
    const noWorker = { ...env, containers: { production: { db: 'prod-db', web: 'prod-web' } } }
    const l = planPush({ target: 'production', env: noWorker, withMedia: false, stamp: 's' }).map((s) => s.label)
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

  it('always migrates and revalidates, and throws without a web container', () => {
    expect(labels).toContain('migrate')
    expect(labels).toContain('revalidate')
    const noWeb = { ...env, containers: { ...env.containers, production: { db: 'prod-db' } } }
    expect(() => planPush({ ...opts, env: noWeb })).toThrow(/web container/)
  })
  it('revalidates every cached page through the web container after migrating', () => {
    const i = labels.indexOf('revalidate')
    expect(i).toBeGreaterThan(labels.indexOf('migrate'))
    expect(steps[i]).toEqual({ label: 'revalidate', where: 'remote', cmd: `docker exec prod-web sh -c ${shq(REVALIDATE_ALL_SCRIPT)}` })
    expect(REVALIDATE_ALL_SCRIPT).toContain('Bearer $REVALIDATE_SECRET')
    expect(REVALIDATE_ALL_SCRIPT).toContain('{"tags":["plugins"]}')
    expect(labels).not.toContain('restart web')
  })
  it('keeps a cache-clear + restart fallback right after revalidate', () => {
    const i = labels.indexOf('revalidate')
    expect(labels[i + 1]).toBe('revalidate fallback')
    expect(steps[i + 1]).toEqual({
      label: 'revalidate fallback',
      where: 'remote',
      cmd: 'docker exec prod-web rm -rf /app/.next/cache/fetch-cache && docker restart prod-web',
    })
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
  it('dumps local inside the dev Postgres container, streaming to a host file', () => {
    const step = steps.find((s) => s.label === 'dump local')!
    expect(step.cmd).toBe(
      "umask 077 && mkdir -p -m 700 .db-dumps && docker compose -f docker-compose.dev.yml exec -T -e PGPASSWORD postgres " +
        "pg_dump -h 127.0.0.1 -p 5432 -U 'directory' -d 'directory' -Fc > './.db-dumps/local-s1.dump'",
    )
    expect(step.env).toEqual({ PGPASSWORD: 'directory' })
  })
  it('keeps the password out of the command and quotes user/db names', () => {
    const url = `postgresql://${encodeURIComponent("o'k")}:${encodeURIComponent('p$w"d')}@localhost:5433/${encodeURIComponent('dir$x')}`
    const step = planPush({ ...opts, env: { ...env, localUrl: url } }).find((s) => s.label === 'dump local')!
    expect(step.cmd).toContain(`-U 'o'\\''k' -d 'dir$x'`)
    expect(step.cmd).not.toContain('p$w')
    expect(step.env).toEqual({ PGPASSWORD: 'p$w"d' })
  })
})

describe('planPull local restore', () => {
  it('restores inside the dev Postgres container from a host file, in one transaction', () => {
    const step = planPull({ target: 'production', env, withMedia: false, stamp: 's' }).find((s) => s.label === 'restore local')!
    expect(step.where).toBe('local')
    expect(step.cmd).toBe(
      "docker compose -f docker-compose.dev.yml exec -T -e PGPASSWORD postgres pg_restore -h 127.0.0.1 -p 5432 -U 'directory' -d 'directory' " +
        "--clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error < './.db-dumps/production-s.dump'",
    )
    expect(step.env).toEqual({ PGPASSWORD: 'directory' })
  })
  it('never attaches env to remote steps', () => {
    const all = [...planPull({ target: 'production', env, withMedia: false, stamp: 's' }), ...planPush({ target: 'production', env, withMedia: true, stamp: 's' })]
    for (const step of all.filter((s) => s.where === 'remote')) expect(step.env).toBeUndefined()
  })
})

describe('parseLocalDatabaseUrl', () => {
  it('decodes user, password and database name', () => {
    expect(parseLocalDatabaseUrl('postgresql://a%40b:p%24ss@localhost:5433/my%20db')).toEqual({ user: 'a@b', password: 'p$ss', dbName: 'my db' })
  })
  it('rejects a URL without a database name', () => {
    expect(() => parseLocalDatabaseUrl('postgresql://u:p@localhost:5433/')).toThrow(/database name/)
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

describe('verify target (push pre-flight)', () => {
  it('is planned first and inspects the target db and web containers by name and label', () => {
    const steps = planPush({ target: 'production', env, withMedia: false, stamp: 's' })
    expect(steps[0]).toEqual(verifyTargetStep('production', env))
    expect(steps[0]).toEqual({
      label: 'verify target',
      where: 'remote',
      cmd: `docker inspect -f '{{.Name}}|{{index .Config.Labels "directory.env"}}' 'prod-db' 'prod-web'`,
    })
  })
})

describe('checkTargetContainers', () => {
  it.each([
    ['/postgres-abc123|production\n/web-abc123|production', 'production'],
    ['/directory-production-db|\n', 'production'],
    ['/directory-production-db|<no value>', 'production'],
    ['/directory_production_db|<no value>', 'production'],
    ['/production|<no value>', 'production'],
    ['/production-clone|production', 'production'], // explicit label wins over name
  ] as const)('accepts %j for %s', (out, target) => {
    expect(checkTargetContainers(target, out)).toEqual([])
  })
  it.each([
    ['/postgres-abc123|<no value>', 'production'], // name does not say, no label
    ['/web|staging', 'production'], // wrong label
    ['/directory-preproduction-db|<no value>', 'production'], // substring, not a whole word
    ['/nonproduction-db|<no value>', 'production'],
    ['/production-clone|<no value>', 'production'],
    ['/production-copy-db|<no value>', 'production'],
    ['/production-test-web|<no value>', 'production'],
    ['/production-preview-1|<no value>', 'production'],
    ['/staging-copy-of-production|<no value>', 'production'], // ambiguous name
    ['/directory-production-db|production\n/directory-staging-web|<no value>', 'production'], // one of two is wrong
    ['', 'production'], // no output
  ] as const)('refuses %j for %s', (out, target) => {
    expect(checkTargetContainers(target, out).length).toBeGreaterThan(0)
  })
})

describe('describeTarget', () => {
  it('names the SSH host, every container and the remote database', () => {
    const text = describeTarget('push', 'production', env).join('\n')
    expect(text).toContain('local → production')
    for (const v of ['kawlya', 'prod-db', 'prod-web', 'prod-worker', 'directory']) expect(text).toContain(v)
    expect(text).not.toContain('stg-')
  })
})
