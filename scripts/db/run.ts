import { execSync } from 'child_process'
import { createInterface } from 'readline/promises'
import { parseArgs } from 'util'
import {
  assertConfirmed,
  checkTargetContainers,
  describeTarget,
  isLocalDatabaseUrl,
  planPull,
  planPush,
  recoveryInfo,
  shq,
  type DbEnv,
  type DbTarget,
} from './plan'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { target: { type: 'string' }, 'with-media': { type: 'boolean', default: false } },
})
const mode = positionals[0] as 'pull' | 'push'
if (mode !== 'pull' && mode !== 'push') throw new Error('Usage: run.ts pull|push [--target production]')
const target = (values.target ?? 'production') as DbTarget
if (target !== 'production') throw new Error(`Unknown target "${target}"`)

const e = process.env
const env: DbEnv = {
  sshHost: e.DB_REMOTE_SSH_HOST ?? 'kawlya',
  dbName: e.DB_REMOTE_DB_NAME ?? 'directory',
  dbUser: e.DB_REMOTE_DB_USER ?? 'directory',
  localUrl: e.DATABASE_URL ?? '',
  containers: {
    production: {
      db: e.DB_REMOTE_PRODUCTION_CONTAINER ?? '',
      worker: e.DB_REMOTE_PRODUCTION_WORKER_CONTAINER || undefined,
      web: e.DB_REMOTE_PRODUCTION_WEB_CONTAINER || undefined,
    },
  },
}
if (!env.containers[target].db) throw new Error(`Set DB_REMOTE_${target.toUpperCase()}_CONTAINER in .env`)
if (mode === 'push' && !env.containers[target].web) {
  throw new Error(`Set DB_REMOTE_${target.toUpperCase()}_WEB_CONTAINER in .env (push needs it to migrate and revalidate)`)
}
if (mode === 'push' && !env.containers[target].worker) {
  throw new Error(`Set DB_REMOTE_${target.toUpperCase()}_WORKER_CONTAINER in .env (push stops the worker during the restore)`)
}
if (!isLocalDatabaseUrl(env.localUrl)) {
  throw new Error('DATABASE_URL must point at the local database')
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const plan = (mode === 'push' ? planPush : planPull)({ target, env, withMedia: values['with-media']!, stamp })

console.log(`\n${describeTarget(mode, target, env).join('\n')}\n`)
for (const step of plan) console.log(`  [${step.where}] ${step.label}`)
const recovery = mode === 'push' ? recoveryInfo({ target, env, stamp }) : undefined
if (recovery) console.log(`\n  Backup of ${target} (kept on ${env.sshHost}): ${recovery.backupFile}`)
const overwritten = mode === 'push' ? target : 'local'
const rl = createInterface({ input: process.stdin, output: process.stdout })
const typed = await rl.question(`\nThis REPLACES the ${overwritten} database. Type "${mode === 'push' ? target : 'local'}" to continue: `)
rl.close()
if (mode === 'push') assertConfirmed(target, typed)
else if (typed !== 'local') throw new Error(`Aborted: expected "local", got "${typed}".`)

const runStep = (step: (typeof plan)[number]) => {
  const cmd = step.where === 'remote' ? `ssh ${env.sshHost} ${shq(step.cmd)}` : step.cmd
  if (step.label === 'verify target') {
    // Capture output: refuse unless the containers really belong to the target environment.
    const out = execSync(cmd, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'], shell: '/bin/bash' })
    const problems = checkTargetContainers(target, out)
    if (problems.length) throw new Error(`Containers do not belong to ${target}:\n  ${problems.join('\n  ')}`)
    console.log(`  ${out.trim().split('\n').join('\n  ')}`)
    return
  }
  execSync(cmd, { stdio: 'inherit', shell: '/bin/bash', env: { ...process.env, ...step.env } })
}

let workerStopped = false
let backupTaken = false
try {
  for (const step of plan) {
    console.log(`→ ${step.label}`)
    if (step.label === 'revalidate fallback') continue // only runs when 'revalidate' fails (below)
    if (step.label === 'stop worker') workerStopped = true
    if (step.label === 'revalidate') {
      try {
        runStep(step)
      } catch (err) {
        console.error(`Revalidation over HTTP failed (${err instanceof Error ? err.message : String(err)}); falling back to clearing the cache and restarting web`)
        runStep(plan.find((s) => s.label === 'revalidate fallback')!)
      }
      continue
    }
    runStep(step)
    if (step.label === 'backup target') backupTaken = true
    if (step.label === 'start worker') workerStopped = false
  }
} catch (err) {
  console.error(`\nStep failed: ${err instanceof Error ? err.message : String(err)}`)
  const startStep = plan.find((s) => s.label === 'start worker')
  if (workerStopped && startStep) {
    console.error('→ attempting recovery: start worker')
    try {
      runStep(startStep)
    } catch {
      console.error(`Could not restart the worker; run on ${env.sshHost}: ${startStep.cmd}`)
    }
  }
  if (recovery && !backupTaken) console.error(`\nNothing on ${target} was changed (failed before the backup step).`)
  if (recovery && backupTaken) {
    console.error(`\nBackup of ${target}: ${recovery.backupFile}`)
    console.error(`Manual restore: ssh ${env.sshHost} ${shq(recovery.restoreCmd)}`)
  }
  process.exit(1)
}
if (recovery) console.log(`\nBackup of ${target} kept on ${env.sshHost}: ${recovery.backupFile}`)
console.log('Done.')
