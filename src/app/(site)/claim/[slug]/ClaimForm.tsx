'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { AlertCircle, CheckCircle2, Clock } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { claimPluginAction, type ClaimState } from './actions'

const initial: ClaimState = { status: 'idle' }

export function ClaimForm({ slug, kind = 'plugin' }: { slug: string; kind?: 'plugin' | 'template' }) {
  const [state, formAction, pending] = useActionState(claimPluginAction, initial)
  const noun = kind === 'template' ? 'template' : 'plugin'
  const returnTo = kind === 'template' ? `/claim/templates/${encodeURIComponent(slug)}` : `/claim/${encodeURIComponent(slug)}`

  if (state.status === 'claimed' || state.status === 'already') {
    return (
      <Alert>
        <CheckCircle2 className="h-4 w-4" />
        <AlertTitle>{state.status === 'claimed' ? 'Claimed' : `You already maintain this ${noun}`}</AlertTitle>
        <AlertDescription>
          {kind === 'template' ? 'Edit its details and screenshots on' : 'Edit its tagline and logo on'} <Link href="/me" className="underline">your page</Link>.
        </AlertDescription>
      </Alert>
    )
  }
  if (state.status === 'queued' || state.status === 'pending') {
    return (
      <Alert>
        <Clock className="h-4 w-4" />
        <AlertTitle>Claim received</AlertTitle>
        <AlertDescription>
          We&apos;ll review your claim shortly. Track it on <Link href="/me" className="underline">your page</Link>.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="kind" value={kind} />
      <div className="space-y-2">
        <label htmlFor="note" className="text-sm font-medium">
          Anything that helps a reviewer? <span className="text-muted-foreground">(optional)</span>
        </label>
        <Textarea id="note" name="note" maxLength={1000} rows={3} placeholder="e.g. I publish this package on npm as …" />
      </div>
      {state.status === 'not_found' && (
        <Alert variant="destructive" role="alert"><AlertCircle className="h-4 w-4" /><AlertDescription>This {noun} is not available.</AlertDescription></Alert>
      )}
      {state.status === 'invalid' && (
        <Alert variant="destructive" role="alert"><AlertCircle className="h-4 w-4" /><AlertDescription className="break-words">{state.message}</AlertDescription></Alert>
      )}
      {state.status === 'signed_out' && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your session expired. <a href={`/auth/github?returnTo=${encodeURIComponent(returnTo)}`} className="underline">Sign in again</a>.
          </AlertDescription>
        </Alert>
      )}
      <Button type="submit" disabled={pending}>{pending ? 'Checking…' : `Claim this ${noun}`}</Button>
    </form>
  )
}
