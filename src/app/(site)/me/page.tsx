import type { Metadata } from 'next'
import Link from 'next/link'
import { getPayload } from 'payload'
import config from '@payload-config'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { requireMaintainer } from '@/lib/auth/current'
import { formatDate } from '@/lib/formatters'
import type { Media, Submission } from '@/payload-types'
import { loadMeData } from '@/lib/maintainers/meData'
import { BrandingForm } from './BrandingForm'
import { ScreenshotManager, TemplateDetailsForm, type ScreenshotThumb } from './TemplateForms'

// Per request and signed-in only: never cached or indexed.
export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Your listings — Payload Directory', robots: { index: false, follow: false } }

const STATUS_VARIANT = { pending: 'secondary', approved: 'default', rejected: 'destructive', duplicate: 'outline' } as const

function StatusBadge({ status }: { status: Submission['status'] }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'outline'} className="capitalize">{status}</Badge>
}

/** The plugin or template a submission points at, when it is linked and still listed (read as the maintainer). */
function listingLink(s: Submission) {
  if (s.kind === 'template') {
    return typeof s.template === 'object' && s.template ? (
      <Link href={`/templates/${encodeURIComponent(s.template.slug)}`} className="underline break-words">{s.template.name}</Link>
    ) : null
  }
  return typeof s.plugin === 'object' && s.plugin ? (
    <Link href={`/plugins/${encodeURIComponent(s.plugin.slug)}`} className="underline break-words">{s.plugin.name}</Link>
  ) : null
}

function KindBadge({ kind }: { kind: Submission['kind'] }) {
  return <Badge variant="outline" className="capitalize">{kind === 'template' ? 'template' : 'plugin'}</Badge>
}

const thumbs = (screenshots: (number | Media)[] | null | undefined): ScreenshotThumb[] =>
  (screenshots ?? []).flatMap((m) => {
    if (typeof m !== 'object' || !m) return []
    const url = m.variants?.card?.url || m.url
    return url ? [{ id: m.id, url, alt: m.alt }] : []
  })

export default async function MePage() {
  const maintainer = await requireMaintainer('/me')
  const payload = await getPayload({ config: await config })
  const { plugins, templates, listings, claims, truncated } = await loadMeData(payload, maintainer)

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-secondary/20">
      <div className="container mx-auto max-w-4xl px-4 py-8 space-y-10">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element -- external GitHub avatar, rendered at fixed size */}
            {maintainer.avatarUrl && <img src={maintainer.avatarUrl} alt="" className="h-12 w-12 rounded-full ring-2 ring-border" />}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight break-all">@{maintainer.login}</h1>
              <p className="text-sm text-muted-foreground">Your plugins, templates, submissions and claims</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" size="sm"><Link href="/submit">Submit a plugin</Link></Button>
            <Button asChild variant="outline" size="sm"><Link href="/submit?type=templates">Submit a template</Link></Button>
            <form action="/auth/logout" method="post"><Button type="submit" variant="ghost" size="sm">Sign out</Button></form>
          </div>
        </header>

        {truncated && <p className="text-sm text-muted-foreground">Showing the latest 100.</p>}

        <section>
          <h2 className="text-lg font-semibold mb-3">Plugins you maintain</h2>
          {plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Use &quot;Claim this plugin&quot; on a plugin page.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {plugins.map((p) => {
                const logoUrl = typeof p.logo === 'object' && p.logo?.url ? p.logo.url : null
                return (
                  <Card key={p.id}>
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element -- Payload media URL, fixed 32px */}
                        {logoUrl && <img src={logoUrl} alt="" className="h-8 w-8 shrink-0 rounded object-contain" />}
                        <Link href={`/plugins/${encodeURIComponent(p.slug)}`} className="font-medium hover:underline break-words min-w-0">{p.name}</Link>
                      </div>
                      <BrandingForm slug={p.slug} customTagline={p.customTagline ?? ''} logoUrl={logoUrl} />
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Templates you maintain</h2>
          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet. Use &quot;Claim this template&quot; on a template page.</p>
          ) : (
            <div className="grid gap-4">
              {templates.map((t) => (
                <Card key={t.id}>
                  <CardContent className="p-4 space-y-4">
                    <Link href={`/templates/${encodeURIComponent(t.slug)}`} className="font-medium hover:underline break-words">{t.name}</Link>
                    <div className="grid gap-6 md:grid-cols-2">
                      <TemplateDetailsForm
                        slug={t.slug}
                        customTagline={t.customTagline ?? ''}
                        demoUrl={t.demoUrl ?? ''}
                        videoUrl={t.videoUrl ?? ''}
                        stackOverride={t.stackOverride ?? null}
                        stackDetected={t.stackDetected ?? null}
                      />
                      <ScreenshotManager slug={t.slug} screenshots={thumbs(t.screenshots)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Your submissions</h2>
          {listings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No submissions.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {listings.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 p-3 text-sm flex-wrap">
                  <span className="font-mono break-all min-w-0">{s.url}</span>
                  <span className="flex items-center gap-3 flex-wrap">
                    <KindBadge kind={s.kind} />
                    {listingLink(s)}
                    <span className="text-muted-foreground">{formatDate(s.createdAt)}</span>
                    <StatusBadge status={s.status} />
                  </span>
                  {s.status === 'rejected' && s.rejectionReason && (
                    <p className="w-full text-xs text-muted-foreground break-words">{s.rejectionReason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="text-lg font-semibold mb-3">Your claims</h2>
          {claims.length === 0 ? (
            <p className="text-sm text-muted-foreground">No claims.</p>
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {claims.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 p-3 text-sm flex-wrap">
                  <span className="flex items-center gap-3 min-w-0">
                    <KindBadge kind={s.kind} />
                    {listingLink(s) ?? <span className="text-muted-foreground">Unavailable {s.kind === 'template' ? 'template' : 'plugin'}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-muted-foreground">{formatDate(s.createdAt)}</span>
                    <StatusBadge status={s.status} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
