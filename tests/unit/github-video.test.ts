import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VideoEmbedView } from '@/components/templates/VideoEmbed'
import { cleanStoredReadmeHtml } from '@/lib/directory/readmeClean'
import { renderReadmeHtml } from '@/lib/directory/readmeHtml'
import { canonicalVideoUrl, embedUrlFor, firstReadmeVideo, parseVideoUrl } from '@/lib/templates/links'

const ID = 'a1fb84d9-c178-4774-99ac-cd11cdc8b284'
const ASSET = `https://github.com/user-attachments/assets/${ID}`
const S3 = `https://github-production-user-asset-6210df.s3.amazonaws.com/36972061/405417858-${ID}.webm?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=abc`
const render = (md: string) => renderReadmeHtml(md, { fullName: 'acme/site', defaultBranch: 'main' }) ?? ''

describe('GitHub-attached videos: the video field', () => {
  it('accepts the stable attachment URL and the expiring S3 link GitHub serves, storing the stable one', () => {
    for (const raw of [ASSET, ASSET.replace(ID, ID.toUpperCase()), S3]) {
      const ref = parseVideoUrl(raw)
      expect(ref).toEqual({ provider: 'github', id: ID })
      expect(canonicalVideoUrl(ref!)).toBe(ASSET)
      expect(embedUrlFor(ref!)).toBe(ASSET)
    }
  })
  it('refuses other GitHub pages, other S3 buckets and non-video files', () => {
    for (const raw of [
      'https://github.com/acme/site',
      `https://github.com/user-attachments/files/${ID}`,
      `https://evil.s3.amazonaws.com/1/2-${ID}.webm`,
      `https://github-production-user-asset-6210df.s3.amazonaws.com/36972061/405417858-${ID}.png`,
      `http://github.com/user-attachments/assets/${ID}`,
    ]) expect(parseVideoUrl(raw)).toBeNull()
  })
})

describe('GitHub-attached videos: README detection', () => {
  it('finds a linked video file or a bare attachment URL on its own line, never an image', () => {
    expect(firstReadmeVideo(`![banner](https://github.com/user-attachments/assets/7bb91f04-a0d3-485b-bc20-97aae3729564)\n\n[Login.webm](${ASSET})`)).toEqual({ provider: 'github', id: ID })
    expect(firstReadmeVideo(`Demo:\n\n${ASSET}\n`)).toEqual({ provider: 'github', id: ID })
    expect(firstReadmeVideo(`![shot.mp4](${ASSET})`)).toBeNull()
    expect(firstReadmeVideo(`See ${ASSET} inline`)).toBeNull()
    expect(firstReadmeVideo(null)).toBeNull()
  })
})

describe('GitHub-attached videos: README HTML', () => {
  it('renders a linked video file and a bare attachment URL as a player that loads nothing before play', () => {
    for (const md of [`[Login---Payload.webm](${ASSET})`, `Demo\n\n${ASSET}\n`]) {
      const html = render(md)
      expect(html).toContain(`<video src="${ASSET}" controls preload="none" playsinline>`)
      expect(html).not.toMatch(/autoplay|poster/i)
    }
  })
  it('keeps image links and ordinary links to attachments as they are', () => {
    expect(render(`[![shot](${ASSET})](${ASSET})`)).not.toContain('<video')
    expect(render(`[download the zip](${ASSET})`)).not.toContain('<video')
  })
  it('turns any other raw <video> into a plain link and drops author attributes', () => {
    const html = render(`<video src="https://evil.example/track.mp4" autoplay poster="https://evil.example/p.png"></video>\n\n<video src="${ASSET}" autoplay muted loop poster="https://evil.example/p.png" onplay="x()"></video>`)
    expect(html).not.toContain('evil.example/p.png')
    expect(html).not.toMatch(/autoplay|onplay|loop|muted/i)
    expect(html).toContain('<a href="https://evil.example/track.mp4"')
    expect(html).toContain(`<video src="${ASSET}" controls preload="none" playsinline>`)
  })
  it('applies the same rules when stored HTML is re-cleaned on read (older READMEs get players too)', () => {
    const stored = `<p><a href="${ASSET}" rel="nofollow ugc noopener noreferrer" target="_blank">Login.webm</a></p><video src="https://evil.example/x.mp4" autoplay></video>`
    const clean = cleanStoredReadmeHtml(stored)!
    expect(clean).toContain(`<video src="${ASSET}" controls preload="none" playsinline>`)
    expect(clean).not.toContain('autoplay')
    expect(clean).not.toMatch(/<video src="https:\/\/evil/)
  })
})

describe('GitHub-attached videos: the player', () => {
  const video = { provider: 'github' as const, embedUrl: ASSET, watchUrl: ASSET }
  it('shows only a play button before the click, then a native player', () => {
    const before = renderToStaticMarkup(createElement(VideoEmbedView, { video, title: 'Demo', playing: false, onPlay: () => {} }))
    expect(before).toContain('Play video (loads GitHub)')
    expect(before).not.toContain(ASSET)
    const after = renderToStaticMarkup(createElement(VideoEmbedView, { video, title: 'Demo', playing: true, onPlay: () => {} }))
    expect(after).toContain(`<video src="${ASSET}"`)
    expect(after).not.toContain('<iframe')
  })
})
