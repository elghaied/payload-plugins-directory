'use client'

import { Card, CardContent } from '@/components/ui/card'
import { CopySnippet as Snippet } from './CopySnippet'

export function BadgeEmbed({ slug, origin }: { slug: string; origin: string }) {
  const page = `${origin}/plugins/${encodeURIComponent(slug)}`
  const badge = `${origin}/badge/${encodeURIComponent(slug)}.svg`
  return (
    <Card className="mb-8">
      <CardContent className="space-y-4 p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs font-medium text-muted-foreground">Badge for your README</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- remote SVG badge, not an optimisable raster */}
          <img src={badge} alt="Payload Directory health badge" height={20} />
        </div>
        <Snippet label="Markdown" value={`[![Payload Directory](${badge})](${page})`} />
        <Snippet label="HTML" value={`<a href="${page}"><img src="${badge}" alt="Payload Directory"></a>`} />
      </CardContent>
    </Card>
  )
}
