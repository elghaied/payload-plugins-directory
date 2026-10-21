'use client'

import { useActionState, useState } from 'react'
import { AlertCircle, ArrowDown, ArrowUp, CheckCircle2, Trash2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SCREENSHOT_MAX_BYTES, SCREENSHOT_MAX_COUNT, SCREENSHOT_MESSAGES } from '@/lib/maintainers/screenshotLimits'
import { STACKS, stackLabel, type StackValue } from '@/lib/templates/stack'
import {
  addTemplateScreenshotAction,
  moveTemplateScreenshotAction,
  removeTemplateScreenshotAction,
  saveTemplateDetailsAction,
  type TemplateEditState,
} from './actions'

const initial: TemplateEditState = { status: 'idle' }

function Outcome({ state, savedText = 'Saved.' }: { state: TemplateEditState; savedText?: string }) {
  if (state.status === 'saved') {
    return (
      <Alert><CheckCircle2 className="h-4 w-4" /><AlertDescription>{savedText}</AlertDescription></Alert>
    )
  }
  if (state.status === 'invalid' || state.status === 'forbidden' || state.status === 'signed_out') {
    return (
      <Alert variant="destructive" role="alert">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription className="break-words">
          {state.status === 'invalid' ? state.message : state.status === 'forbidden' ? 'You do not maintain this template.' : 'Your session expired. Sign in again.'}
        </AlertDescription>
      </Alert>
    )
  }
  return null
}

export function TemplateDetailsForm({
  slug,
  customTagline,
  demoUrl,
  videoUrl,
  stackOverride,
  stackDetected,
}: {
  slug: string
  customTagline: string
  demoUrl: string
  videoUrl: string
  stackOverride: StackValue | null
  stackDetected: StackValue | null
}) {
  const [state, formAction, pending] = useActionState(saveTemplateDetailsAction, initial)
  // Controlled: React resets an action form's uncontrolled fields after every submit, which would wipe what the owner
  // typed when the server refuses one value.
  const [values, setValues] = useState({ tagline: customTagline, demoUrl, videoUrl, stackOverride: stackOverride ?? '' })
  const bind = (name: keyof typeof values) => ({
    name,
    value: values[name],
    onChange: (e: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: e.target.value })),
  })
  const id = (name: string) => `${name}-${slug}`
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <div className="space-y-1.5">
        <label htmlFor={id('tagline')} className="text-xs font-medium text-muted-foreground">Tagline</label>
        <Input id={id('tagline')} {...bind('tagline')} maxLength={120} placeholder="One line about what it is for" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id('demo')} className="text-xs font-medium text-muted-foreground">Live demo URL (https)</label>
        <Input id={id('demo')} {...bind('demoUrl')} type="url" maxLength={500} placeholder="https://demo.example.com" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id('video')} className="text-xs font-medium text-muted-foreground">Video (YouTube, Vimeo or Loom)</label>
        <Input id={id('video')} {...bind('videoUrl')} type="url" maxLength={500} placeholder="https://www.youtube.com/watch?v=…" />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id('stack')} className="text-xs font-medium text-muted-foreground">Stack</label>
        <select
          id={id('stack')}
          {...bind('stackOverride')}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <option value="">Detected{stackDetected ? ` (${stackLabel(stackDetected)})` : ''}</option>
          {STACKS.map((s) => (
            <option key={s} value={s}>{stackLabel(s)}</option>
          ))}
        </select>
      </div>
      <Outcome state={state} />
      <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : 'Save details'}</Button>
    </form>
  )
}

export type ScreenshotThumb = { id: number; url: string; alt: string }

function ScreenshotItem({ slug, shot, index, count }: { slug: string; shot: ScreenshotThumb; index: number; count: number }) {
  const [moveState, moveAction, moving] = useActionState(moveTemplateScreenshotAction, initial)
  const [removeState, removeAction, removing] = useActionState(removeTemplateScreenshotAction, initial)
  const busy = moving || removing
  const failed = [moveState, removeState].find((s) => s.status !== 'idle' && s.status !== 'saved')
  return (
    <li className="space-y-1.5">
      {/* eslint-disable-next-line @next/next/no-img-element -- Payload media URL (card variant), fixed size */}
      <img src={shot.url} alt={shot.alt} className="aspect-video w-full rounded border bg-muted object-cover" loading="lazy" />
      {/* One small form per button: each carries its own hidden fields (a submitter's name/value is not relied on). */}
      <div className="flex items-center gap-1">
        {(['up', 'down'] as const).map((direction) => (
          <form key={direction} action={moveAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="mediaId" value={shot.id} />
            <input type="hidden" name="direction" value={direction} />
            <Button type="submit" variant="outline" size="icon" className="h-7 w-7"
              disabled={busy || (direction === 'up' ? index === 0 : index === count - 1)}
              aria-label={`Move screenshot ${index + 1} ${direction}`}>
              {direction === 'up' ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />}
            </Button>
          </form>
        ))}
        <form action={removeAction} className="ml-auto">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="mediaId" value={shot.id} />
          <Button type="submit" variant="ghost" size="sm" className="h-7 px-2 text-destructive hover:text-destructive"
            disabled={busy} aria-label={`Remove screenshot ${index + 1}`}>
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        </form>
      </div>
      {failed && <Outcome state={failed} />}
    </li>
  )
}

export function ScreenshotManager({ slug, screenshots }: { slug: string; screenshots: ScreenshotThumb[] }) {
  const [state, formAction, pending] = useActionState(addTemplateScreenshotAction, initial)
  const [fileError, setFileError] = useState<string | null>(null)
  const full = screenshots.length >= SCREENSHOT_MAX_COUNT
  return (
    <div className="space-y-3">
      <p className="text-xs font-medium text-muted-foreground">Screenshots ({screenshots.length}/{SCREENSHOT_MAX_COUNT})</p>
      {screenshots.length > 0 && (
        <ol className="grid grid-cols-2 gap-3">
          {screenshots.map((shot, i) => (
            <ScreenshotItem key={shot.id} slug={slug} shot={shot} index={i} count={screenshots.length} />
          ))}
        </ol>
      )}
      <form action={formAction} className="space-y-1.5">
        <input type="hidden" name="slug" value={slug} />
        <label htmlFor={`screenshot-${slug}`} className="text-xs text-muted-foreground">
          PNG, JPEG or WebP, up to 2 MB and 4096 px, max 8
        </label>
        <div className="flex gap-2">
          <Input
            id={`screenshot-${slug}`}
            name="screenshot"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={full || pending}
            onChange={(e) => {
              // Checked before upload so a too-big file never reaches the server (which would fail with a generic error).
              const file = e.target.files?.[0]
              if (file && file.size > SCREENSHOT_MAX_BYTES) {
                setFileError(SCREENSHOT_MESSAGES.tooBig)
                e.target.value = ''
              } else setFileError(null)
            }}
          />
          <Button type="submit" size="sm" disabled={full || pending}>{pending ? 'Uploading…' : 'Upload'}</Button>
        </div>
        {fileError && <p role="alert" className="text-xs text-destructive">{fileError}</p>}
        {full && <p className="text-xs text-muted-foreground">{SCREENSHOT_MESSAGES.tooMany} Remove one to add another.</p>}
        <Outcome state={state} savedText="Uploaded." />
      </form>
    </div>
  )
}
