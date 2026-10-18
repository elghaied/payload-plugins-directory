import { execSync } from 'child_process'
import { createInterface } from 'readline/promises'
import { parseArgs } from 'util'
import { assertConfirmed, planPull, planPush, type DbEnv, type DbTarget } from './plan'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { target: { type: 'string' }, 'with-media': { type: 'boolean', default: false } },
})
const mode = positionals[0] as 'pull' | 'push'
if (mode !== 'pull' && mode !== 'push') throw new Error('Usage: run.ts pull|push [--target staging|production]')
const target = (values.target ?? (mode === 'push' ? 'staging' : 'production')) as DbTarget
if (target !== 'staging' && target !== 'production') throw new Error(`Unknown target "${target}"`)

const e = process.env
const env: DbEnv = {
  sshHost: e.DB_REMOTE_SSH_HOST ?? 'kawlya',
  dbName: e.DB_REMOTE_DB_NAME ?? 'directory',
  dbUser: e.DB_REMOTE_DB_USER ?? 'directory',
  localUrl: e.DATABASE_URL ?? '',
  containers: {
    staging: {
      db: e.DB_REMOTE_STAGING_CONTAINER ?? '',
      worker: e.DB_REMOTE_STAGING_WORKER_CONTAINER || undefined,
      web: e.DB_REMOTE_STAGING_WEB_CONTAINER || undefined,
    },
    production: {
      db: e.DB_REMOTE_PRODUCTION_CONTAINER ?? '',
      worker: e.DB_REMOTE_PRODUCTION_WORKER_CONTAINER || undefined,
      web: e.DB_REMOTE_PRODUCTION_WEB_CONTAINER || undefined,
    },
  },
}
if (!env.containers[target].db) throw new Error(`Set DB_REMOTE_${target.toUpperCase()}_CONTAINER in .env`)
if (!env.localUrl.includes('localhost') && !env.localUrl.includes('127.0.0.1')) {
  throw new Error('DATABASE_URL must point at the local database')
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const plan = (mode === 'push' ? planPush : planPull)({ target, env, withMedia: values['with-media']!, stamp })

console.log(`\n${mode.toUpperCase()} ${mode === 'push' ? `local → ${target}` : `${target} → local`}\n`)
for (const step of plan) console.log(`  [${step.where}] ${step.label}`)
const overwritten = mode === 'push' ? target : 'local'
const rl = createInterface({ input: process.stdin, output: process.stdout })
const typed = await rl.question(`\nThis REPLACES the ${overwritten} database. Type "${mode === 'push' ? target : 'local'}" to continue: `)
rl.close()
if (mode === 'push') assertConfirmed(target, typed)
else if (typed !== 'local') throw new Error(`Aborted: expected "local", got "${typed}".`)

for (const step of plan) {
  console.log(`→ ${step.label}`)
  const cmd = step.where === 'remote' ? `ssh ${env.sshHost} ${JSON.stringify(step.cmd)}` : step.cmd
  execSync(cmd, { stdio: 'inherit', shell: '/bin/bash' })
}
console.log('Done.')
