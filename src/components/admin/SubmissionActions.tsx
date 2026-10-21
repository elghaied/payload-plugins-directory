'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@payloadcms/ui'

type Status = 'approved' | 'rejected' | 'duplicate'
type PayloadError = { message?: string; data?: { errors?: { message?: string }[] } }

/** Payload's REST error body: field messages from a ValidationError when present, else the top-level message. */
function errorText(body: { errors?: PayloadError[] } | null, status: number): string {
  const first = body?.errors?.[0]
  const fields = first?.data?.errors?.map((e) => e.message).filter(Boolean)
  return fields?.length ? fields.join(' ') : first?.message ?? `Request failed (${status})`
}

/**
 * Approve / Reject / Duplicate for one pending submission, through the normal REST update: the collection's hooks run
 * exactly as when an admin saves the document (repository resolution, the queued sync, the maintainer grant).
 */
export function SubmissionActions({ id, label }: { id: number; label: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState<Status | null>(null)
  const [error, setError] = useState<string | null>(null)

  const update = async (status: Status) => {
    let rejectionReason: string | undefined
    if (status === 'rejected') {
      const reason = window.prompt(`Reject ${label}? Optional reason (the submitter sees it):`, '')
      if (reason === null) return
      rejectionReason = reason.trim() || undefined
    }
    setBusy(status)
    setError(null)
    try {
      const res = await fetch(`/api/submissions/${id}?depth=0`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, ...(rejectionReason ? { rejectionReason } : {}) }),
      })
      if (!res.ok) throw new Error(errorText(await res.json().catch(() => null), res.status))
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
      setBusy(null)
    }
  }

  const button = (status: Status, text: string, style: 'primary' | 'secondary') => (
    <Button buttonStyle={style} size="medium" margin={false} disabled={busy !== null} onClick={() => update(status)}>
      {busy === status ? '…' : text}
    </Button>
  )

  return (
    <div style={{ display: 'grid', gap: '0.25rem', justifyItems: 'end' }}>
      <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {button('approved', 'Approve', 'primary')}
        {button('rejected', 'Reject', 'secondary')}
        {button('duplicate', 'Duplicate', 'secondary')}
      </div>
      {error && (
        <span role="alert" style={{ color: 'var(--theme-error-500)', fontSize: '0.75rem', maxWidth: '22rem', textAlign: 'right' }}>
          {error}
        </span>
      )}
    </div>
  )
}
