import { describe, expect, it } from 'vitest'
import { diffPaths, extractSitemapPaths } from '../../scripts/parity'

describe('extractSitemapPaths', () => {
  it('returns sorted paths regardless of host', () => {
    const xml = `<urlset><url><loc>https://payloaddirectory.dev/plugins/b</loc></url><url><loc>https://payloaddirectory.dev/</loc></url></urlset>`
    expect(extractSitemapPaths(xml)).toEqual(['/', '/plugins/b'])
  })
})

describe('diffPaths', () => {
  it('reports both sides', () => {
    expect(diffPaths(['/', '/a', '/b'], ['/', '/b', '/c'])).toEqual({ onlyInA: ['/a'], onlyInB: ['/c'] })
  })
})
