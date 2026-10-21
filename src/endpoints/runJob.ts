import type { Endpoint } from 'payload'
import { isAdminUser } from '@/access'
import { isManualJobTask, queueManualJob } from '@/sync/manualJobs'

/** POST /api/run-job/:task — the dashboard's "Run now". Admin only; only MANUAL_JOBS tasks, with their scheduled input. */
export const runJobEndpoint: Endpoint = {
  path: '/run-job/:task',
  method: 'post',
  handler: async (req) => {
    if (!isAdminUser(req.user)) return Response.json({ error: 'Forbidden' }, { status: 403 })
    const task = String(req.routeParams?.task ?? '')
    if (!isManualJobTask(task)) return Response.json({ error: 'Not found' }, { status: 404 })
    try {
      const status = await queueManualJob(req.payload, task, new Date())
      return Response.json({ status })
    } catch (error) {
      req.payload.logger.error({ err: error, task }, 'Run job now failed')
      return Response.json({ error: 'Could not queue the job' }, { status: 500 })
    }
  },
}
