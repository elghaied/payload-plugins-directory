'use client'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useDocumentInfo } from '@payloadcms/ui'

/** Admin sidebar action on a plugin: moves the listing to the templates collection (the plugin goes to Trash). */
export function ConvertToTemplateButton() {
  const { id } = useDocumentInfo()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!id) return null

  const convert = async () => {
    if (!window.confirm('Convert this plugin to a template? The plugin moves to Trash and a template with the same slug is created.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/${id}/convert-to-template`, { method: 'POST', credentials: 'include' })
      const body = (await res.json().catch(() => null)) as { templateSlug?: string; error?: string } | null
      if (!res.ok || !body?.templateSlug) throw new Error(body?.error ?? `Request failed (${res.status})`)
      router.push(`/admin/collections/templates?where[slug][equals]=${encodeURIComponent(body.templateSlug)}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Conversion failed')
      setBusy(false)
    }
  }

  return (
    <div className="field-type">
      <button type="button" className="btn btn--style-secondary btn--size-medium" disabled={busy} onClick={convert}>
        {busy ? 'Converting…' : 'Convert to template'}
      </button>
      {error ? <p style={{ color: 'var(--theme-error-500)' }}>{error}</p> : null}
    </div>
  )
}
