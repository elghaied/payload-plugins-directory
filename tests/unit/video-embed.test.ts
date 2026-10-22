import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VideoEmbed, VideoEmbedView } from '@/components/templates/VideoEmbed'

const youtube = { provider: 'youtube' as const, embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
const view = (playing: boolean, poster?: string) =>
  renderToStaticMarkup(createElement(VideoEmbedView, { video: youtube, poster, title: 'Demo video', playing, onPlay: () => {} }))

describe('VideoEmbed', () => {
  it('renders a play button and no iframe before the click', () => {
    const html = renderToStaticMarkup(createElement(VideoEmbed, { video: youtube, title: 'Demo video' }))
    expect(html).toContain('<button')
    expect(html).toContain('aria-label="Play video (loads YouTube)"')
    expect(html).not.toContain('<iframe')
    expect(html).not.toMatch(/youtube(-nocookie)?\.com/)
  })

  it('names the provider in the label for Vimeo and Loom', () => {
    const vimeo = renderToStaticMarkup(createElement(VideoEmbed, { video: { provider: 'vimeo', embedUrl: 'https://player.vimeo.com/video/1?dnt=1', watchUrl: 'https://vimeo.com/1' } }))
    expect(vimeo).toContain('Play video (loads Vimeo)')
    const loom = renderToStaticMarkup(createElement(VideoEmbed, { video: { provider: 'loom', embedUrl: 'https://www.loom.com/embed/x', watchUrl: 'https://www.loom.com/share/x' } }))
    expect(loom).toContain('Play video (loads Loom)')
  })

  it('autoplays after the click (Ruling 7): autoplay=1 joins an existing query for Vimeo and Loom', () => {
    const play = (video: { provider: 'vimeo' | 'loom'; embedUrl: string; watchUrl: string }) =>
      renderToStaticMarkup(createElement(VideoEmbedView, { video, title: 'v', playing: true, onPlay: () => {} }))
    expect(play({ provider: 'vimeo', embedUrl: 'https://player.vimeo.com/video/1?dnt=1', watchUrl: 'https://vimeo.com/1' }))
      .toContain('src="https://player.vimeo.com/video/1?dnt=1&amp;autoplay=1"')
    expect(play({ provider: 'loom', embedUrl: 'https://www.loom.com/embed/x', watchUrl: 'https://www.loom.com/share/x' }))
      .toContain('src="https://www.loom.com/embed/x?autoplay=1"')
  })

  it('uses only a local poster, never a remote thumbnail', () => {
    const html = view(false, '/api/media/file/shot.webp')
    expect(html).toContain('src="/api/media/file/shot.webp"')
    expect(html).not.toContain('ytimg')
    expect(view(false)).not.toContain('<img')
  })

  it('renders the sandboxed youtube-nocookie iframe once playing', () => {
    const html = view(true)
    expect(html).toMatch(/<iframe[^>]*src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?autoplay=1"/)
    expect(html).toContain('title="Demo video"')
    expect(html).toContain('allow="autoplay; fullscreen; picture-in-picture"')
    expect(html).toContain('referrerPolicy="strict-origin-when-cross-origin"')
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"')
    expect(html).toContain('loading="lazy"')
    expect(html).not.toContain('Play video (loads')
  })
})
