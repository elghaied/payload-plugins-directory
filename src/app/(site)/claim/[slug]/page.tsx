import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getPayload } from 'payload'
import config from '@payload-config'
import { ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { requireMaintainer } from '@/lib/auth/current'
import { relationId } from '@/lib/relationId'
import { ClaimForm } from './ClaimForm'

// Per request and signed-in only: never cached or indexed.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Claim a plugin — Payload Directory', robots: { index: false, follow: false } }

export default async function ClaimPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const maintainer = await requireMaintainer(`/claim/${encodeURIComponent(slug)}`)
  const payload = await getPayload({ config: await config })
  const found = await payload.find({
    collection: 'plugins',
    overrideAccess: false,
    user: maintainer,
    depth: 0,
    limit: 1,
    where: { slug: { equals: slug } },
  })
  const plugin = found.docs[0]
  if (!plugin) notFound()
  const alreadyMaintainer = (plugin.maintainers ?? []).map(relationId).includes(maintainer.id)

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <Link href={`/plugins/${encodeURIComponent(plugin.slug)}`} className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />
          Back to {plugin.name}
        </Link>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight break-words">Claim {plugin.name}</h1>
        <p className="mt-2 text-muted-foreground break-words">
          Signed in as <span className="font-medium text-foreground">@{maintainer.login}</span>. We check your GitHub account against the
          repository. If we can confirm you own it, you are added right away; otherwise an admin reviews your claim.
        </p>
        <Card className="mt-6">
          <CardContent className="p-6">
            {alreadyMaintainer ? (
              <p className="text-sm">
                You already maintain this plugin. Edit it on <Link href="/me" className="underline">your page</Link>.
              </p>
            ) : (
              <ClaimForm slug={plugin.slug} />
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
