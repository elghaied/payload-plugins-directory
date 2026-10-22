'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import { CheckCircle2, AlertCircle, Info } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { ListingKind } from '@/lib/submissions/duplicates'
import { MESSAGES } from '@/lib/submissions/messages'
import { submitListingAction, type SubmitState } from './actions'

const listingHref = (type: ListingKind, slug: string) => `/${type === 'template' ? 'templates' : 'plugins'}/${encodeURIComponent(slug)}`

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
      if (state.kind === 'template') {
        return (
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle className="break-words">{MESSAGES.templateListed(state.name)}</AlertTitle>
            <AlertDescription>
              <Link href={listingHref('template', state.slug)} className="underline">View the listing</Link>
            </AlertDescription>
          </Alert>
        )
      }
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
    case 'otherType':
      return (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="break-words">
            {MESSAGES.otherType(state.existingType, state.name)}{' '}
            <Link href={listingHref(state.existingType, state.slug)} className="underline">View the listing</Link>
          </AlertDescription>
        </Alert>
      )
    case 'pending':
      return (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="break-words">{state.kind === 'template' ? MESSAGES.templatePending : MESSAGES.pending}</AlertDescription>
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

const KIND_OPTIONS: { value: ListingKind; label: string }[] = [
  { value: 'plugin', label: 'Plugin' },
  { value: 'template', label: 'Template' },
]

export function SubmitForm({ defaultKind = 'plugin' }: { defaultKind?: ListingKind }) {
  const [state, formAction, pending] = useActionState(submitListingAction, initial)
  const [kind, setKind] = useState<ListingKind>(defaultKind)
  const template = kind === 'template'
  return (
    <form action={formAction} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What are you submitting?</legend>
        <div className="flex gap-4">
          {KIND_OPTIONS.map((option) => (
            <label key={option.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => setKind(option.value)}
                className="h-4 w-4 accent-primary"
              />
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-2">
        <label htmlFor="url" className="text-sm font-medium">
          {template ? 'GitHub repository or folder URL' : 'GitHub repository or npm package URL'}
        </label>
        <Input
          id="url"
          name="url"
          type="url"
          required
          maxLength={300}
          placeholder={template ? 'https://github.com/owner/repo/tree/main/path' : 'https://github.com/owner/repo'}
          autoComplete="off"
          aria-describedby={template ? 'url-help' : undefined}
        />
        {template && (
          <p id="url-help" className="text-sm text-muted-foreground">
            Tip: add the <code className="font-mono">payload-template</code> topic to your repository and it is listed automatically. You
            can also submit it here, topic or not. Templates in a subfolder are fine: paste the
            folder&apos;s URL (for example <code className="font-mono">https://github.com/owner/repo/tree/main/apps/site</code>).
          </p>
        )}
      </div>
      <div className="space-y-2">
        <label htmlFor="note" className="text-sm font-medium">Note for the reviewer <span className="text-muted-foreground">(optional)</span></label>
        <Textarea id="note" name="note" maxLength={1000} rows={3} />
      </div>
      <Result state={state} />
      <Button type="submit" disabled={pending}>{pending ? 'Submitting…' : template ? 'Submit template' : 'Submit plugin'}</Button>
    </form>
  )
}
