import { ImageResponse } from 'next/og'
import { BRAND } from '@/lib/brand'

export const alt = 'Payload Plugin Directory'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  const { light } = BRAND
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          padding: '0 96px',
          background: '#f4f4f1',
          color: '#1c1c1a',
        }}
      >
        <svg width="260" height="260" viewBox="0 0 32 32" style={{ flexShrink: 0 }}>
          <rect width="32" height="32" rx="8" fill={light.square} />
          {BRAND.glyph.map((s, i) =>
            s.tag === 'rect' ? (
              <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} fill={light.glyph} />
            ) : (
              <path key={i} d={s.d} fill={light.glyph} />
            ),
          )}
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', marginLeft: 72 }}>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Payload Plugin</div>
          <div style={{ fontSize: 88, fontWeight: 700, lineHeight: 1.05, letterSpacing: -2 }}>Directory</div>
          <div style={{ marginTop: 28, fontSize: 32, color: '#4d4d49' }}>Find, compare and trust Payload CMS plugins</div>
          <div style={{ marginTop: 12, fontSize: 28, color: light.square }}>payloaddirectory.dev</div>
        </div>
      </div>
    ),
    size,
  )
}
