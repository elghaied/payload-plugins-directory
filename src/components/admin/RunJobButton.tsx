'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@payloadcms/ui'

/** One dashboard "Run now" button: queues the job for the worker's next tick (within about a minute). */
export function RunJobButton({ task, label, hint, confirm }: { task: string; label: string; hint: string; confirm?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null)

  const run = async () => {
    if (confirm && !window.confirm(confirm)) return
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch(`/api/run-job/${encodeURIComponent(task)}`, { method: 'POST', credentials: 'include' })
      const body = (await res.json().catch(() => null)) as { status?: string; error?: string } | null
      if (!res.ok || !body?.status) throw new Error(body?.error ?? `Request failed (${res.status})`)
      setMessage({ text: body.status === 'queued' ? 'Queued: the worker starts it within a minute.' : 'Already queued or running.' })
      router.refresh()
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : 'Could not queue the job', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ display: 'grid', gap: '0.25rem', alignContent: 'start', justifyItems: 'start' }}>
      <Button buttonStyle="secondary" size="medium" margin={false} disabled={busy} onClick={run} tooltip={hint}>
        {busy ? 'Queueing…' : label}
      </Button>
      <span style={{ fontSize: '0.75rem', color: message?.error ? 'var(--theme-error-500)' : 'var(--theme-elevation-600)' }} role={message ? 'status' : undefined}>
        {message?.text ?? hint}
      </span>
    </div>
  )
}
