import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/brand'
import { getServerURL } from '@/lib/serverUrl'

export const alt = 'Payload Directory'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const TAGLINE = 'Official and community plugins for Payload CMS.'

export default async function OpengraphImage() {
  const fontPath = (f: string) => join(process.cwd(), 'src/app/og-fonts', f)
  const [regular, semibold] = await Promise.all([readFile(fontPath('Geist-Regular.ttf')), readFile(fontPath('Geist-SemiBold.ttf'))])
  const domain = getServerURL().replace(/^https?:\/\//, '') || 'payloaddirectory.dev'
  const { og } = BRAND

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          padding: '80px 80px',
          background: og.background,
          color: og.foreground,
          fontFamily: 'Geist',
        }}
      >
        {/* Large faint mark, right */}
        <svg width="380" height="380" viewBox="0 0 32 32" style={{ position: 'absolute', right: 40, top: 125 }}>
          <path fill={og.faint} fillRule="evenodd" d={BRAND.blockPath} />
          <path fill={BRAND.amber.dark} d={BRAND.slotPath} />
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', height: '100%' }}>
          <svg width="64" height="64" viewBox="0 0 32 32">
            <path fill={BRAND.neutral.dark} fillRule="evenodd" d={BRAND.blockPath} />
            <path fill={BRAND.amber.dark} d={BRAND.slotPath} />
          </svg>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ fontSize: 88, fontWeight: 600, lineHeight: 1.05, letterSpacing: -2.5 }}>Payload Directory</div>
            <div style={{ marginTop: 28, fontSize: 30, color: og.muted }}>{TAGLINE}</div>
            <div style={{ marginTop: 40, fontSize: 28 }}>{domain}</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: [
      { name: 'Geist', data: regular, weight: 400, style: 'normal' },
      { name: 'Geist', data: semibold, weight: 600, style: 'normal' },
    ] },
  )
}
