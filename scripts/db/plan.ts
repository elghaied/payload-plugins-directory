export type DbTarget = 'staging' | 'production'
export type DbStep = { label: string; where: 'local' | 'remote'; cmd: string }
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

const dumpFile = (stamp: string, kind: string) => `/tmp/directory-${kind}-${stamp}.dump`
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
      cmd: `pg_restore ${RESTORE_FLAGS} -d ${shq(env.localUrl)} ${shq(localFile)}`,
    },
  ]
}

export function planPush({ target, env, withMedia, stamp }: PlanOpts): DbStep[] {
  const { db, worker, web } = env.containers[target]
  if (!web) throw new Error(`A web container is required to push to ${target}`)
  const localFile = `./.db-dumps/local-${stamp}.dump`
  const remoteFile = dumpFile(stamp, 'local')
  const { backupFile } = recoveryInfo({ target, env, stamp })
  const steps: DbStep[] = [
    {
      label: 'dump local',
      where: 'local',
      cmd: `umask 077 && mkdir -p -m 700 .db-dumps && pg_dump -Fc -d ${shq(env.localUrl)} -f ${shq(localFile)}`,
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
  // Restarting web clears the Next data cache (phase 0 "full revalidation").
  steps.push({ label: 'restart web', where: 'remote', cmd: `docker restart ${web}` })
  steps.push({ label: 'cleanup', where: 'remote', cmd: `rm -f ${shq(remoteFile)}` })
  return steps
}
