import { BRAND } from '@/lib/brand'
import { cn } from '@/lib/utils'

/** The directory logo mark; picks the light or dark colourway from the site theme class. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn('h-7 w-7 shrink-0', className)} xmlns="http://www.w3.org/2000/svg">
      <rect width="32" height="32" rx="8" className="fill-[#0f766e] dark:fill-[#2dd4bf]" />
      <g className="fill-white dark:fill-[#042f2e]">
        {BRAND.glyph.map((s, i) =>
          s.tag === 'rect' ? (
            <rect key={i} x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} />
          ) : (
            <path key={i} d={s.d} />
          ),
        )}
      </g>
    </svg>
  )
}
