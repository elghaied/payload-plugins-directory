'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { toast } from '@payloadcms/ui'

/** Compact "Run now": queues a directory-wide job for the worker's next tick (within about a minute). */
export function RunJobButton({ task, label, confirm }: { task: string; label: string; confirm?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (confirm && !window.confirm(confirm)) return
    setBusy(true)
    try {
      const res = await fetch(`/api/run-job/${encodeURIComponent(task)}`, { method: 'POST', credentials: 'include' })
      const body = (await res.json().catch(() => null)) as { status?: string; error?: string } | null
      if (!res.ok || !body?.status) throw new Error(body?.error ?? `Request failed (${res.status})`)
      if (body.status === 'queued') toast.success(`${label} queued: the worker starts it within a minute.`)
      else toast.info(`${label} is already queued or running.`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not queue the job')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" className="pd-run-btn" disabled={busy} onClick={run} aria-label={`Run ${label} now`}>
      <span aria-hidden>▶</span> {busy ? 'Queueing…' : 'Run now'}
    </button>
  )
}
