'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Re-renders the dashboard's server widgets every `intervalMs` while the tab is visible, and says so. Fast while jobs
 * run or wait, slow when the worker is idle (the widget picks the interval).
 */
export function LiveRefresh({ intervalMs, busy }: { intervalMs: number; busy: boolean }) {
  const router = useRouter()
  const [at, setAt] = useState<string>('')
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      router.refresh()
      setAt(new Date().toLocaleTimeString())
    }, intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, router])
  return (
    <span className="pd-live" title={`Refreshes every ${Math.round(intervalMs / 1000)} s`}>
      <span className={`pd-dot ${busy ? 'pd-dot--running' : 'pd-dot--ok'}`} aria-hidden />
      {busy ? 'Live' : 'Idle'}
      {at && <span suppressHydrationWarning>· updated {at}</span>}
    </span>
  )
}
