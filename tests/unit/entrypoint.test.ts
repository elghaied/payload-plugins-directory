import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SCRIPT = readFileSync(path.resolve(__dirname, '../../docker/entrypoint.sh'), 'utf8')

/** Runs the real entrypoint with stub `npx` / `node` binaries; `npx` fails for the commands named in `failing`. */
function runWeb(failing: string[]) {
  const dir = mkdtempSync(path.join(tmpdir(), 'entrypoint-'))
  const bin = path.join(dir, 'bin')
  const cli = path.join(dir, 'cli')
  mkdirSync(bin)
  mkdirSync(cli)
  const log = path.join(dir, 'calls.log')
  const stub = (name: string, body: string) => {
    writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`)
    chmodSync(path.join(bin, name), 0o755)
  }
  stub('npx', `echo "npx $*" >> "${log}"\ncase " $2 " in *" reindex-search "*) sleep 1; echo "npx reindex done" >> "${log}";; esac\ncase " ${failing.join(' ')} " in *" $2 "*) exit 1;; esac`)
  stub('node', `echo "node $*" >> "${log}"`)
  const script = path.join(dir, 'entrypoint.sh')
  writeFileSync(script, SCRIPT.replaceAll('/app/cli', cli))
  const res = spawnSync('sh', [script, 'web'], { env: { PATH: `${bin}:/usr/bin:/bin` } as unknown as NodeJS.ProcessEnv, encoding: 'utf8' })
  return { ...res, calls: readFileSync(log, 'utf8').trim().split('\n') }
}

describe('docker/entrypoint.sh web', () => {
  it('migrates, then starts the server without waiting for the background search reindex', () => {
    const res = runWeb([])
    expect(res.status).toBe(0)
    expect(res.calls[0]).toBe('npx payload migrate')
    expect(res.calls).toContain('npx payload reindex-search --if-incomplete')
    // The stub reindex takes a second: the server must have started before it finished.
    expect(res.calls.indexOf('node /app/server.js')).toBeLessThan(res.calls.indexOf('npx reindex done'))
  })

  it('logs loudly but still starts the server when the reindex fails', () => {
    const res = runWeb(['reindex-search'])
    expect(res.status).toBe(0)
    expect(res.stderr).toContain('search reindex failed')
    expect(res.calls).toContain('node /app/server.js')
  })

  it('does not start the server when migrations fail', () => {
    const res = runWeb(['migrate'])
    expect(res.status).not.toBe(0)
    expect(res.calls).toEqual(['npx payload migrate'])
  })
})
