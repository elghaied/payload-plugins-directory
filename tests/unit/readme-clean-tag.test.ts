import { describe, expect, it, vi } from 'vitest'

const calls = vi.hoisted(() => [] as { keys: string[]; tags: string[] }[])
vi.mock('next/cache', () => ({
  unstable_cache: (fn: () => unknown, keys: string[], opts: { tags: string[] }) => {
    calls.push({ keys, tags: opts.tags })
    return fn
  },
}))

import { getCleanReadmeHtml } from '@/lib/directory/readmeClean'
import { pluginTag, templateTag } from '@/lib/cacheTags'

describe('getCleanReadmeHtml cache tag', () => {
  it('defaults to the plugin tag and takes the template tag from the template page', async () => {
    calls.length = 0
    await getCleanReadmeHtml('seo', '<p>x</p>', 'v1')
    await getCleanReadmeHtml('template-website', '<p>x</p>', 'v1', templateTag('website'))
    expect(calls.map((c) => c.tags)).toEqual([[pluginTag('seo')], [templateTag('website')]])
    expect(calls[1].keys).toContain('template-website')
  })
})
