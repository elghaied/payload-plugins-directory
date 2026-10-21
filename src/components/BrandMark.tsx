import { cn } from '@/lib/utils'
import { BRAND } from '@/lib/brand'

/**
 * The directory logo mark. The block takes `currentColor` (the site foreground) and the slot takes the
 * `--brand-amber` token, which flips with the site theme (see globals.css).
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label="Payload Directory"
      className={cn('h-7 w-7 shrink-0 text-foreground', className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      <path fill="currentColor" fillRule="evenodd" d={BRAND.blockPath} />
      <path fill="var(--brand-amber)" d={BRAND.slotPath} />
    </svg>
  )
}
