/** Time formatting for the dashboard widgets (server-rendered; the live refresh keeps relative times current). */

export function relativeTime(iso: string | null, now: Date): string {
  if (!iso) return '–'
  const diff = Date.parse(iso) - now.getTime()
  const abs = Math.abs(diff)
  const future = diff > 0
  const say = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`)
  if (abs < 45_000) return future ? 'in a moment' : 'just now'
  if (abs < 3_600_000) return say(Math.max(1, Math.round(abs / 60_000)), 'min')
  if (abs < 48 * 3_600_000) return say(Math.round(abs / 3_600_000), 'h')
  return say(Math.round(abs / 86_400_000), 'd')
}

export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '–'
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
  const min = Math.floor(ms / 60_000)
  const s = Math.round((ms % 60_000) / 1000)
  return min < 60 ? `${min} min${s ? ` ${s} s` : ''}` : `${Math.floor(min / 60)} h ${min % 60} min`
}

/** "00:15 UTC"; with the date when it is not today (UTC). */
export function clock(iso: string | null, now: Date): string {
  if (!iso) return '–'
  const d = new Date(iso)
  const hm = d.toISOString().slice(11, 16)
  return d.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? `${hm} UTC` : `${d.toISOString().slice(5, 10)} ${hm} UTC`
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`
