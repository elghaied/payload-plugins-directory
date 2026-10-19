import { describe, expect, it } from 'vitest'
import { Media } from '@/collections/Media'

describe('Media upload headers', () => {
  it('serves files with nosniff', () => {
    const upload = Media.upload as { modifyResponseHeaders: (a: { headers: Headers }) => Headers }
    expect(upload.modifyResponseHeaders({ headers: new Headers() }).get('X-Content-Type-Options')).toBe('nosniff')
  })
})
