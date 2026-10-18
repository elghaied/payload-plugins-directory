import type { Endpoint } from 'payload'
import { sql } from '@payloadcms/db-postgres/drizzle'

export const healthEndpoint: Endpoint = {
  path: '/health',
  method: 'get',
  handler: async (req) => {
    try {
      await req.payload.db.drizzle.execute(sql`select 1`)
      return Response.json({ status: 'ok' })
    } catch {
      return Response.json({ status: 'error' }, { status: 503 })
    }
  },
}
