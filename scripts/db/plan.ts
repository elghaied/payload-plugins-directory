export type DbTarget = 'staging' | 'production'
/** `env` holds extra variables for a local step's process (kept out of `cmd` so secrets are never printed). */
export type DbStep = { label: string; where: 'local' | 'remote'; cmd: string; env?: Record<string, string> }
export type DbEnv = {
  sshHost: string
  dbName: string
  dbUser: string
  localUrl: string
  containers: Record<DbTarget, { db: string; worker?: string; web?: string }>
}
type PlanOpts = { target: DbTarget; env: DbEnv; withMedia: boolean; stamp: string }

export function assertConfirmed(target: DbTarget, typed: string): void {
  if (typed !== target) throw new Error(`Aborted: expected "${target}", got "${typed}".`)
}

/** Single-quote a value for safe interpolation into a POSIX shell command. */
export function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** True only when the URL's host is exactly localhost, 127.0.0.1 or ::1. */
export function isLocalDatabaseUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url)
    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname)
  } catch {
    return false
  }
}

/** The dev Postgres runs in docker-compose.dev.yml; the host has no (v18) pg_dump/pg_restore. */
export const LOCAL_COMPOSE = 'docker compose -f docker-compose.dev.yml exec -T -e PGPASSWORD postgres'

/** User, password and database name from the local DATABASE_URL (host/port are the host-side mapping, unused). */
export function parseLocalDatabaseUrl(url: string): { user: string; password: string; dbName: string } {
  const u = new URL(url)
  const dbName = decodeURIComponent(u.pathname.replace(/^\//, ''))
  if (!u.username || !dbName) throw new Error('DATABASE_URL must include a user and a database name')
  return { user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), dbName }
}

/**
 * pg_dump/pg_restore run inside the dev Postgres container over TCP on its own port 5432;
 * the password reaches it as PGPASSWORD via `exec -e PGPASSWORD` (inherited from the step env).
 */
function localPg(tool: 'pg_dump' | 'pg_restore', localUrl: string): { cmd: string; env: Record<string, string> } {
  const { user, password, dbName } = parseLocalDatabaseUrl(localUrl)
  return {
    cmd: `${LOCAL_COMPOSE} ${tool} -h 127.0.0.1 -p 5432 -U ${shq(user)} -d ${shq(dbName)}`,
    env: { PGPASSWORD: password },
  }
}

const dumpFile = (stamp: string, kind: string) => `/tmp/directory-${kind}-${stamp}.dump`
/** Next's on-disk data cache inside the web image (Dockerfile WORKDIR /app, standalone output). */
export const NEXT_FETCH_CACHE_DIR = '/app/.next/cache/fetch-cache'
const RESTORE_FLAGS = '--clean --if-exists --no-owner --no-acl --single-transaction --exit-on-error'

/** Where the pre-push backup of the target lives, and how to restore it by hand (remote command). */
export function recoveryInfo({ target, env, stamp }: Pick<PlanOpts, 'target' | 'env' | 'stamp'>): {
  backupFile: string
  restoreCmd: string
} {
  const { db } = env.containers[target]
  const backupFile = `/root/directory-backups/${target}-before-push-${stamp}.dump`
  return {
    backupFile,
    restoreCmd: `docker exec -i ${db} pg_restore -U ${env.dbUser} -d ${env.dbName} ${RESTORE_FLAGS} < ${shq(backupFile)}`,
  }
}

export function planPull({ target, env, stamp }: PlanOpts): DbStep[] {
  const { db } = env.containers[target]
  const remoteFile = dumpFile(stamp, target)
  const localFile = `./.db-dumps/${target}-${stamp}.dump`
  const restore = localPg('pg_restore', env.localUrl)
  return [
    {
      label: 'dump remote',
      where: 'remote',
      cmd: `umask 077 && docker exec ${db} pg_dump -U ${env.dbUser} -d ${env.dbName} -Fc > ${shq(remoteFile)}`,
    },
    {
      label: 'copy dump',
      where: 'local',
      cmd: `umask 077 && mkdir -p -m 700 .db-dumps && scp ${env.sshHost}:${shq(remoteFile)} ${shq(localFile)}`,
    },
    { label: 'cleanup remote', where: 'remote', cmd: `rm -f ${shq(remoteFile)}` },
    {
      label: 'restore local',
      where: 'local',
      cmd: `${restore.cmd} ${RESTORE_FLAGS} < ${shq(localFile)}`,
      env: restore.env,
    },
  ]
}

export function planPush({ target, env, withMedia, stamp }: PlanOpts): DbStep[] {
  const { db, worker, web } = env.containers[target]
  if (!web) throw new Error(`A web container is required to push to ${target}`)
  const localFile = `./.db-dumps/local-${stamp}.dump`
  const remoteFile = dumpFile(stamp, 'local')
  const { backupFile } = recoveryInfo({ target, env, stamp })
  const dump = localPg('pg_dump', env.localUrl)
  const steps: DbStep[] = [
    {
      label: 'dump local',
      where: 'local',
      cmd: `umask 077 && mkdir -p -m 700 .db-dumps && ${dump.cmd} -Fc > ${shq(localFile)}`,
      env: dump.env,
    },
    { label: 'copy dump', where: 'local', cmd: `scp ${shq(localFile)} ${env.sshHost}:${shq(remoteFile)}` },
    {
      label: 'backup target',
      where: 'remote',
      cmd: `umask 077 && mkdir -p -m 700 /root/directory-backups && docker exec ${db} pg_dump -U ${env.dbUser} -d ${env.dbName} -Fc > ${shq(backupFile)}`,
    },
  ]
  if (worker) steps.push({ label: 'stop worker', where: 'remote', cmd: `docker stop ${worker}` })
  steps.push({
    label: 'restore',
    where: 'remote',
    cmd: `docker exec -i ${db} pg_restore -U ${env.dbUser} -d ${env.dbName} ${RESTORE_FLAGS} < ${shq(remoteFile)}`,
  })
  steps.push({ label: 'migrate', where: 'remote', cmd: `docker exec ${web} sh -c 'cd /app/cli && npx payload migrate'` })
  if (worker) steps.push({ label: 'start worker', where: 'remote', cmd: `docker start ${worker}` })
  if (withMedia) {
    steps.push({
      label: 'sync media',
      where: 'local',
      cmd: `rsync -az ./media/ ${env.sshHost}:/tmp/directory-media/ && ssh ${env.sshHost} ${shq(`docker cp /tmp/directory-media/. ${web}:/app/media/`)}`,
    })
  }
  // Phase 0 "full revalidation": unstable_cache entries persist on disk in the standalone server's
  // .next/cache/fetch-cache (serverDistDir/../cache/fetch-cache, WORKDIR /app) and survive a restart,
  // so delete them first; the restart then drops the in-memory copy.
  steps.push({ label: 'clear cache', where: 'remote', cmd: `docker exec ${web} rm -rf ${NEXT_FETCH_CACHE_DIR}` })
  steps.push({ label: 'restart web', where: 'remote', cmd: `docker restart ${web}` })
  steps.push({ label: 'cleanup', where: 'remote', cmd: `rm -f ${shq(remoteFile)}` })
  return steps
}
