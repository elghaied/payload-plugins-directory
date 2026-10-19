import Link from 'next/link'

export type RankedRow = {
  key: string
  href: string
  avatar: string
  title: string
  subtitle?: string
  /** Visual value, e.g. "+70 ★". */
  value: string
  /** Screen-reader wording of the value, e.g. "70 new stars". */
  valueLabel: string
  /** Secondary text under the value, e.g. "+4.1%". */
  detail?: string
}

export function RankedList({ rows, empty }: { rows: RankedRow[]; empty: string }) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
  }
  return (
    <ol className="space-y-3">
      {rows.map((row, i) => (
        <li key={row.key} className="flex items-center gap-2 sm:gap-3">
          <span aria-hidden className="w-5 text-right text-xs tabular-nums text-muted-foreground">
            {i + 1}.
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote GitHub avatars, same as the rest of the site */}
          <img src={row.avatar} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Link href={row.href} className="block truncate text-sm font-medium hover:underline">
              {row.title}
            </Link>
            {row.subtitle && <p className="truncate text-xs text-muted-foreground">{row.subtitle}</p>}
          </div>
          <div className="shrink-0 text-right">
            <span className="sr-only">{row.valueLabel}</span>
            <span aria-hidden className="block font-mono text-sm font-medium">
              {row.value}
            </span>
            {row.detail && (
              <span aria-hidden className="block text-[10px] text-muted-foreground">
                {row.detail}
              </span>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
