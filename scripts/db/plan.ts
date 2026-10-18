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

const dumpFile = (stamp: string, kind: string) => `/tmp/directory-${kind}-${stamp}.dump`

export function planPull({ target, env, stamp }: PlanOpts): DbStep[] {
  const { db } = env.containers[target]
  const remoteFile = dumpFile(stamp, `${target}`)
  const localFile = `./.db-dumps/${target}-${stamp}.dump`
  return [
    {
      label: 'dump remote',
      where: 'remote',
      cmd: `docker exec ${db} pg_dump -U ${env.dbUser} -d ${env.dbName} -Fc > ${remoteFile}`,
    },
    { label: 'copy dump', where: 'local', cmd: `mkdir -p .db-dumps && scp ${env.sshHost}:${remoteFile} ${localFile}` },
    {
      label: 'restore local',
      where: 'local',
      cmd: `pg_restore --clean --if-exists --no-owner --no-acl -d "${env.localUrl}" ${localFile}`,
    },
  ]
}

export function planPush({ target, env, withMedia, stamp }: PlanOpts): DbStep[] {
  const { db, worker, web } = env.containers[target]
  const localFile = `./.db-dumps/local-${stamp}.dump`
  const remoteFile = dumpFile(stamp, 'local')
  const backupFile = `/root/directory-backups/${target}-before-push-${stamp}.dump`
  const steps: DbStep[] = [
    { label: 'dump local', where: 'local', cmd: `mkdir -p .db-dumps && pg_dump -Fc -d "${env.localUrl}" -f ${localFile}` },
    { label: 'copy dump', where: 'local', cmd: `scp ${localFile} ${env.sshHost}:${remoteFile}` },
    {
      label: 'backup target',
      where: 'remote',
      cmd: `mkdir -p /root/directory-backups && docker exec ${db} pg_dump -U ${env.dbUser} -d ${env.dbName} -Fc > ${backupFile}`,
    },
  ]
  if (worker) steps.push({ label: 'stop worker', where: 'remote', cmd: `docker stop ${worker}` })
  steps.push({
    label: 'restore',
    where: 'remote',
    cmd: `docker exec -i ${db} pg_restore -U ${env.dbUser} -d ${env.dbName} --clean --if-exists --no-owner --no-acl < ${remoteFile}`,
  })
  if (web) steps.push({ label: 'migrate', where: 'remote', cmd: `docker exec ${web} sh -c 'cd /app/cli && npx payload migrate'` })
  if (worker) steps.push({ label: 'start worker', where: 'remote', cmd: `docker start ${worker}` })
  if (withMedia && web) {
    steps.push({
      label: 'sync media',
      where: 'local',
      cmd: `rsync -az ./media/ ${env.sshHost}:/tmp/directory-media/ && ssh ${env.sshHost} 'docker cp /tmp/directory-media/. ${web}:/app/media/'`,
    })
  }
  if (web) steps.push({ label: 'restart web', where: 'remote', cmd: `docker restart ${web}` })
  return steps
}
