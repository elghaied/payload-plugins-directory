'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { MESSAGES } from '@/lib/submissions/messages'
import { submitListingAction, type SubmitState } from './actions'

const initial: SubmitState = { status: 'idle' }

function Result({ state }: { state: SubmitState }) {
  switch (state.status) {
    case 'idle':
      return null
    case 'created':
      return (
        <Alert>
          <CheckCircle2 className="h-4 w-4" />
          <AlertTitle>Submitted</AlertTitle>
          <AlertDescription>
            Thanks! An admin will review it. Track it on <Link href="/me" className="underline">your page</Link>.
          </AlertDescription>
        </Alert>
      )
    case 'listed':
      return (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle className="break-words">{MESSAGES.listed(state.name)}</AlertTitle>
          <AlertDescription>
            <Link href={`/plugins/${encodeURIComponent(state.slug)}`} className="underline">View the listing</Link>
            {' · '}
            <Link href={`/claim/${encodeURIComponent(state.slug)}`} className="underline">Claim it</Link>
          </AlertDescription>
        </Alert>
      )
    case 'signed_out':
      return (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Your session expired. <a href="/auth/github?returnTo=%2Fsubmit" className="underline">Sign in again</a>.
          </AlertDescription>
        </Alert>
      )
    default: {
      const message = state.status === 'invalid' ? state.message : MESSAGES[state.status]
      return (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="break-words">{message}</AlertDescription>
        </Alert>
      )
    }
  }
}

export function SubmitForm() {
  const [state, formAction, pending] = useActionState(submitListingAction, initial)
  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <label htmlFor="url" className="text-sm font-medium">GitHub repository or npm package URL</label>
        <Input
          id="url"
          name="url"
          type="url"
          required
          maxLength={300}
          placeholder="https://github.com/owner/repo"
          autoComplete="off"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="note" className="text-sm font-medium">Note for the reviewer <span className="text-muted-foreground">(optional)</span></label>
        <Textarea id="note" name="note" maxLength={1000} rows={3} />
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Submitting…' : 'Submit plugin'}</Button>
    </form>
  )
}
