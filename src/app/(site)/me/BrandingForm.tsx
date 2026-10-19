'use client'

import { useActionState, useState } from 'react'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LOGO_MAX_BYTES, LOGO_MESSAGES } from '@/lib/maintainers/logoLimits'
import { saveBrandingAction, type BrandingState } from './actions'

const initial: BrandingState = { status: 'idle' }

export function BrandingForm({ slug, customTagline, logoUrl }: { slug: string; customTagline: string; logoUrl: string | null }) {
  const [state, formAction, pending] = useActionState(saveBrandingAction, initial)
  const [fileError, setFileError] = useState<string | null>(null)
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="space-y-1.5">
        <label htmlFor={`tagline-${slug}`} className="text-xs font-medium text-muted-foreground">Tagline</label>
        <Input id={`tagline-${slug}`} name="tagline" maxLength={120} defaultValue={customTagline} placeholder="One line about what it does" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`logo-${slug}`} className="text-xs font-medium text-muted-foreground">Logo (PNG, JPEG or WebP, up to 512 KB)</label>
        <Input id={`logo-${slug}`} name="logo" type="file" accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            // Checked before upload so a too-big file never reaches the server (which would fail with a generic error).
            const file = e.target.files?.[0]
            if (file && file.size > LOGO_MAX_BYTES) {
              setFileError(LOGO_MESSAGES.tooBig)
              e.target.value = ''
            } else setFileError(null)
          }}
        />
        {fileError && <p role="alert" className="text-xs text-destructive">{fileError}</p>}
        {logoUrl && (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" name="removeLogo" className="h-3.5 w-3.5" /> Remove current logo
          </label>
        )}
      </div>
      {state.status === 'saved' && (
        <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>Saved.</AlertDescription></Alert>
      )}
      {(state.status === 'invalid' || state.status === 'forbidden' || state.status === 'signed_out') && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {state.status === 'invalid' ? state.message : state.status === 'forbidden' ? 'You do not maintain this plugin.' : 'Your session expired. Sign in again.'}
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save'}</Button>
    </form>
  )
}
