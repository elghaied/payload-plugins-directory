'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'

/** Boundary for any (site) page that throws while rendering: a plain explanation and a way forward. */
export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="container mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">This page could not be displayed</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Something went wrong while building it. Try again, or go back to the directory.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button onClick={() => reset()}>Try again</Button>
        <Button variant="outline" asChild>
          <Link href="/">Browse plugins</Link>
        </Button>
      </div>
    </main>
  )
}
