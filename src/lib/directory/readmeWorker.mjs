// Worker-thread entry for renderReadmeIsolated.ts: plain JS so no loader is needed to start it. TypeScript sources
// are loaded through tsx's programmatic API. Protocol: posts { type: 'ready' }, receives { source, repo },
// posts { type: 'result', html, reason? } (html is a string or null).
import { parentPort } from 'node:worker_threads'
import { register } from 'tsx/esm/api'

register()
const { renderReadmeDetailed } = await import('./readmeHtml.ts')

parentPort.once('message', ({ source, repo }) => {
  parentPort.postMessage({ type: 'result', ...renderReadmeDetailed(source, repo) })
})
parentPort.postMessage({ type: 'ready' })
