'use client'

/**
 * "Good morning / afternoon / evening" in the viewer's own time zone. The server render uses UTC; the browser re-renders
 * with local time on hydration, hence suppressHydrationWarning.
 */
export function Greeting({ name }: { name: string | null }) {
  const h = new Date().getHours()
  const part = h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 18 ? 'afternoon' : 'evening'
  return (
    <h1 suppressHydrationWarning>
      Good {part}
      {name ? `, ${name}` : ''}.
    </h1>
  )
}
