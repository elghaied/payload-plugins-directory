import { beforeEach, describe, expect, it, vi } from 'vitest'

// A faithful stand-in for unstable_cache: results memoised by key parts, tags recorded.
const store = vi.hoisted(() => ({ results: new Map<string, unknown>(), calls: 0, tags: [] as string[][], keys: [] as string[][] }))
vi.mock('next/cache', () => ({
  unstable_cache:
    <T>(fn: () => Promise<T>, keyParts: string[], opts: { tags: string[] }) =>
    async () => {
      const key = keyParts.join('|')
      store.keys.push(keyParts)
      store.tags.push(opts.tags)
      if (!store.results.has(key)) {
        store.calls++
        store.results.set(key, JSON.parse(JSON.stringify(await fn())))
      }
      return store.results.get(key) as T
    },
}))

import { getReadmeTree } from '@/lib/directory/readmeCache'

const repo = { fullName: 'acme/plugins', defaultBranch: 'main' }
beforeEach(() => {
  store.results.clear()
  store.calls = 0
  store.tags = []
  store.keys = []
})

describe('getReadmeTree cache', () => {
  it('renders a large README once, however many requests read it', async () => {
    const big = Array.from({ length: 1_500 }, (_, i) => `## Section ${i}\n\n| a | b |\n|---|---|\n| ${i} | x |\n\nSome **text** with \`code\` and [a link](docs/${i}.md).\n`).join('\n')
    expect(big.length).toBeGreaterThan(50_000)
    const first = await getReadmeTree('p-1', big, repo)
    for (let i = 0; i < 20; i++) await getReadmeTree('p-1', big, repo)
    expect(store.calls).toBe(1)
    expect(first.tree).not.toBeNull()
  })
  it('re-renders when the README changes, and keys include the slug', async () => {
    await getReadmeTree('p-1', 'one', repo)
    await getReadmeTree('p-1', 'two', repo)
    await getReadmeTree('p-2', 'one', repo)
    expect(store.calls).toBe(3)
  })
  it('tags entries with the plugin tag', async () => {
    await getReadmeTree('p-1', 'one', repo)
    expect(store.tags[0]).toEqual(['plugin:p-1'])
  })
  it('caches the plain-text fallback for pathological input too', async () => {
    const hostile = '>'.repeat(100_000)
    expect((await getReadmeTree('p-1', hostile, repo)).tree).toBeNull()
    await getReadmeTree('p-1', hostile, repo)
    expect(store.calls).toBe(1)
  })
})
