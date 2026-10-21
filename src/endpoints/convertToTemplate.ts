import type { Endpoint } from 'payload'
import { commitTransaction, initTransaction, killTransaction } from 'payload'
import { isAdminUser } from '@/access'
import { convertPluginToTemplate } from '@/lib/templates/convert'

/** POST /api/plugins/:id/convert-to-template. Admin only (maintainers reach /api/plugins, so the check lives here). */
export const convertToTemplateEndpoint: Endpoint = {
  path: '/:id/convert-to-template',
  method: 'post',
  handler: async (req) => {
    if (!isAdminUser(req.user)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const id = String(req.routeParams?.id ?? '')
    if (!/^\d+$/.test(id)) return Response.json({ error: 'Not found' }, { status: 404 })
    const started = await initTransaction(req)
    try {
      const result = await convertPluginToTemplate(req.payload, Number(id), req)
      if (started) await commitTransaction(req)
      if (result.status === 'missing') return Response.json({ error: 'Not found' }, { status: 404 })
      if (result.status === 'slug-taken') {
        return Response.json(
          { error: 'A template with this slug exists (it may be in Trash). Restore or delete it first.', status: result.status, templateSlug: result.templateSlug },
          { status: 409 },
        )
      }
      return Response.json(result)
    } catch (error) {
      if (started) await killTransaction(req)
      req.payload.logger.error({ err: error }, 'Convert to template failed')
      return Response.json({ error: 'Conversion failed' }, { status: 500 })
    }
  },
}
