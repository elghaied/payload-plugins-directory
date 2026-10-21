import { strictObject, z } from 'payload'
import { defineCLICommand } from 'payload/cli'
import { renderReadmeIsolated } from '@/lib/directory/renderReadmeIsolated'
import { renderReadmes } from '@/lib/directory/renderReadmes'
import { readmeRenderVersion } from '@/lib/directory/readmeVersion'

export const renderReadmesCommand = defineCLICommand({
  description:
    'Render README Markdown to sanitized HTML (isolated worker threads) for plugins whose stored render version is out of date. --all re-renders every plugin.',
  input: strictObject({ all: z._default(z.boolean(), false) }),
  handler: async ({ args, getPayload }) => {
    const payload = await getPayload()
    const started = Date.now()
    const result = await renderReadmes(payload, { render: (s, r) => renderReadmeIsolated(s, r), version: readmeRenderVersion }, { all: args.all })
    payload.logger.info({ ...result, seconds: Math.round((Date.now() - started) / 1000) }, 'README render complete')
    return { result }
  },
})
