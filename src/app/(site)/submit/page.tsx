import type { Metadata } from 'next'
import { Card, CardContent } from '@/components/ui/card'
import { requireMaintainer } from '@/lib/auth/current'
import { SubmitForm } from './SubmitForm'

// Per request and signed-in only: never cached or indexed. Absolute URLs come from metadataBase (getServerURL() in the layout).
export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Submit a plugin — Payload Plugin Directory',
  alternates: { canonical: '/submit' },
  robots: { index: false, follow: false },
}

export default async function SubmitPage() {
  const maintainer = await requireMaintainer('/submit')
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Submit a plugin</h1>
        <p className="mt-2 text-muted-foreground break-words">
          Signed in as <span className="font-medium text-foreground">@{maintainer.login}</span>. Plugins tagged with the{' '}
          <code className="font-mono text-sm">payload-plugin</code> GitHub topic are found automatically; use this form for anything we missed.
        </p>
        <Card className="mt-6">
          <CardContent className="p-6">
            <SubmitForm />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
