export type DbTarget = 'production'
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
/**
 * Runs inside the web container (busybox wget). Every cached query carries the `plugins` tag (src/lib/cacheTags.ts),
 * so this marks every cached page stale. REVALIDATE_SECRET is expanded by the container's shell and never leaves it.
 */
export const REVALIDATE_ALL_SCRIPT = `wget -qO- --header "Authorization: Bearer $REVALIDATE_SECRET" --header 'Content-Type: application/json' --post-data '{"tags":["plugins"]}' http://127.0.0.1:3000/api/revalidate`
/** Fallback when the HTTP call fails: Next's on-disk data cache inside the web image (WORKDIR /app, standalone). */
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

/** Docker label that marks a container's environment when its name does not say it (e.g. Coolify UUID names). */
export const ENV_LABEL = 'directory.env'
const INSPECT_SEP = '|'

/** Pre-flight: print name and environment label of the target's db, web and worker containers, one line each. */
export function verifyTargetStep(target: DbTarget, env: DbEnv): DbStep {
  const { db, web, worker } = env.containers[target]
  const names = [db, web, worker].filter(Boolean).map((n) => shq(n!)).join(' ')
  return {
    label: 'verify target',
    where: 'remote',
    cmd: `docker inspect -f '{{.Name}}${INSPECT_SEP}{{index .Config.Labels "${ENV_LABEL}"}}' ${names}`,
  }
}

/** A name containing one of these words is never accepted by name alone (e.g. `production-clone`); use the label. */
const UNSAFE_NAME_WORDS = ['staging', 'preview', 'clone', 'copy', 'test']

/**
 * Checks `verifyTargetStep` output. A container passes when its `directory.env` label equals the target,
 * or, when it has no such label, when its name contains the target as a whole word (split on non-alphanumerics)
 * and none of the words in UNSAFE_NAME_WORDS. Returns the reasons it refuses (empty = OK).
 */
export function checkTargetContainers(target: DbTarget, inspectOutput: string): string[] {
  const lines = inspectOutput.split('\n').map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return ['docker inspect printed nothing']
  const problems: string[] = []
  for (const line of lines) {
    const i = line.lastIndexOf(INSPECT_SEP)
    const name = (i === -1 ? line : line.slice(0, i)).replace(/^\//, '')
    const rawLabel = i === -1 ? '' : line.slice(i + 1).trim()
    const label = rawLabel === '<no value>' ? '' : rawLabel
    if (label) {
      if (label !== target) problems.push(`${name}: label ${ENV_LABEL}=${label}, expected ${target}`)
      continue
    }
    // Whole words only: "directory-preproduction-db" must not pass for production.
    const words = name.toLowerCase().split(/[^a-z0-9]+/)
    if (!words.includes(target) || words.some((w) => UNSAFE_NAME_WORDS.includes(w))) {
      problems.push(`${name}: name does not identify ${target} and it has no ${ENV_LABEL}=${target} label`)
    }
  }
  return problems
}

/** Human-readable header for the confirmation prompt: where the commands will run and on what. */
export function describeTarget(mode: 'pull' | 'push', target: DbTarget, env: DbEnv): string[] {
  const { db, web, worker } = env.containers[target]
  return [
    `${mode.toUpperCase()} ${mode === 'push' ? `local → ${target}` : `${target} → local`}`,
    `  SSH host:         ${env.sshHost}`,
    `  DB container:     ${db}`,
    `  Web container:    ${web ?? '(none)'}`,
    `  Worker container: ${worker ?? '(none)'}`,
    `  Remote database:  ${env.dbName} (user ${env.dbUser})`,
  ]
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
  // The worker writes to the database every minute: a restore under a running worker would race its jobs.
  if (!worker) throw new Error(`A worker container is required to push to ${target} (it is stopped during the restore)`)
  const localFile = `./.db-dumps/local-${stamp}.dump`
  const remoteFile = dumpFile(stamp, 'local')
  const { backupFile } = recoveryInfo({ target, env, stamp })
  const dump = localPg('pg_dump', env.localUrl)
  const steps: DbStep[] = [
    verifyTargetStep(target, env),
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
  steps.push({ label: 'stop worker', where: 'remote', cmd: `docker stop ${worker}` })
  steps.push({
    label: 'restore',
    where: 'remote',
    cmd: `docker exec -i ${db} pg_restore -U ${env.dbUser} -d ${env.dbName} ${RESTORE_FLAGS} < ${shq(remoteFile)}`,
  })
  steps.push({ label: 'migrate', where: 'remote', cmd: `docker exec ${web} sh -c 'cd /app/cli && npx payload migrate'` })
  steps.push({ label: 'start worker', where: 'remote', cmd: `docker start ${worker}` })
  if (withMedia) {
    steps.push({
      label: 'sync media',
      where: 'local',
      cmd: `rsync -az ./media/ ${env.sshHost}:/tmp/directory-media/ && ssh ${env.sshHost} ${shq(`docker cp /tmp/directory-media/. ${web}:/app/media/`)}`,
    })
  }
  // Full revalidation (spec §12.1) through /api/revalidate. If the HTTP call fails, run.ts falls back to
  // `revalidate fallback`: unstable_cache entries persist on disk in .next/cache/fetch-cache and survive a
  // restart, so delete them and restart web to drop the in-memory copy.
  steps.push({ label: 'revalidate', where: 'remote', cmd: `docker exec ${web} sh -c ${shq(REVALIDATE_ALL_SCRIPT)}` })
  steps.push({ label: 'revalidate fallback', where: 'remote', cmd: `docker exec ${web} rm -rf ${NEXT_FETCH_CACHE_DIR} && docker restart ${web}` })
  steps.push({ label: 'cleanup', where: 'remote', cmd: `rm -f ${shq(remoteFile)}` })
  return steps
}
