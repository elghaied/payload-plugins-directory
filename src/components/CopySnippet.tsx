'use client'

import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** A labelled, copyable code snippet (README badges, MCP client setup). */
export function CopySnippet({ label, value }: { label: string; value: string }) {
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
