import { describe, expect, it } from 'vitest'
import { firstReadmeImage } from '@/lib/templates/fallbackImage'

const SHOT = 'https://raw.githubusercontent.com/a/b/main/shot.png'

describe('firstReadmeImage', () => {
  it('returns the first allow-listed https image', () => {
    expect(firstReadmeImage(`<p><img src="${SHOT}" alt="Home"></p>`)).toBe(SHOT)
    expect(firstReadmeImage('<p>none</p>')).toBeNull()
    expect(firstReadmeImage(null)).toBeNull()
  })

  it('skips deploy buttons and badges by src, alt or enclosing link', () => {
    const html = [
      '<p><a href="https://vercel.com/new/clone?repository-url=x"><img src="https://vercel.com/button" alt="Deploy with Vercel"></a>',
      '<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/a/b"><img src="https://raw.githubusercontent.com/a/b/main/cf.svg" alt=""></a>',
      '<img src="https://img.shields.io/npm/v/x" alt="npm">',
      '<img src="https://raw.githubusercontent.com/a/b/main/status.svg" alt="Build badge">',
      '<a href="https://example.com/x">Deploy now <img src="https://raw.githubusercontent.com/a/b/main/arrow.png"></a>',
      '<a href="https://example.com/x"><img src="https://raw.githubusercontent.com/a/b/main/btn.png"> Click the button</a></p>',
      `<p><a href="https://example.com/demo"><img src="${SHOT}" alt="Home page"></a></p>`,
    ].join('')
    expect(firstReadmeImage(html)).toBe(SHOT)
  })

  it('skips images with an explicit width or height under 200 px', () => {
    const html = [
      '<img src="https://raw.githubusercontent.com/a/b/main/logo.png" width="120">',
      '<img src="https://raw.githubusercontent.com/a/b/main/icon.png" height="64px">',
      `<img src="${SHOT}" width="800" height="50%">`,
    ].join('')
    expect(firstReadmeImage(html)).toBe(SHOT)
    expect(firstReadmeImage(`<img width='199' src="https://raw.githubusercontent.com/a/b/main/x.png">`)).toBeNull()
  })

  it('a closed link no longer counts as the enclosing link', () => {
    expect(firstReadmeImage(`<a href="https://vercel.com/new">Deploy</a><img src="${SHOT}">`)).toBe(SHOT)
  })

  it('stays fast on adversarial HTML (20k unclosed links) and gives up after a bounded number of tags', () => {
    const hostile = '<a href="x">'.repeat(20_000) + `<img src="${SHOT}">`
    const start = performance.now()
    expect(firstReadmeImage(hostile)).toBeNull()
    expect(performance.now() - start).toBeLessThan(500)
    const longText = `<a href="https://example.com">${'word '.repeat(50_000)}</a><img src="${SHOT}">`
    const t2 = performance.now()
    expect(firstReadmeImage(longText)).toBe(SHOT)
    expect(performance.now() - t2).toBeLessThan(500)
  })
})
