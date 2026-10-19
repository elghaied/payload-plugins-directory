'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

function Snippet({ label, value }: { label: string; value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            let next: 'copied' | 'failed' = 'copied'
            try {
              await navigator.clipboard.writeText(value)
            } catch {
              next = 'failed'
            }
            setState(next)
            setTimeout(() => setState('idle'), next === 'failed' ? 4000 : 1500)
          }}
        >
          {state === 'copied' ? <Check /> : <Copy />}
          {state === 'copied' ? 'Copied' : 'Copy'}
        </Button>
      </div>
      {state === 'failed' && (
        <p role="status" className="text-xs text-destructive">
          Copy failed — select and copy manually
        </p>
      )}
      <code className="block overflow-x-auto whitespace-pre rounded-lg bg-secondary/50 px-3 py-2 font-mono text-xs">{value}</code>
    </div>
  )
}

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
