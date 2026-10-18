import { describe, expect, it } from 'vitest'
import { getTestPayload } from './helpers/payload'
import { healthEndpoint } from '@/endpoints/health'

describe('GET /api/health', () => {
  it('reports ok when the database answers', async () => {
    const payload = await getTestPayload()
    const res = await healthEndpoint.handler({ payload } as never)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
