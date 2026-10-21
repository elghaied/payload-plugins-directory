// Worker-thread entry for renderReadmeIsolated.ts: plain JS so no loader is needed to start it. TypeScript sources
// are loaded through tsx's programmatic API. Protocol: posts { type: 'ready' }, receives { source, repo },
// posts { type: 'result', html } (string or null).
import { parentPort } from 'node:worker_threads'
import { register } from 'tsx/esm/api'

register()
const { renderReadmeHtml } = await import('./readmeHtml.ts')

parentPort.once('message', ({ source, repo }) => {
  parentPort.postMessage({ type: 'result', html: renderReadmeHtml(source, repo) })
})
parentPort.postMessage({ type: 'ready' })
