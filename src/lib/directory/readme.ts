/**
 * First ~500 characters of a README, cut at the last sentence or paragraph break past 200 characters —
 * the preview the legacy fetch script stored. Sync now stores the full README; the detail page keeps
 * showing this preview until Phase 2 redesigns it.
 */
export function readmePreview(readme: string | null | undefined): string | undefined {
  if (!readme) return undefined
  let preview = readme.slice(0, 500)
  const breakPoint = Math.max(preview.lastIndexOf('. '), preview.lastIndexOf('\n\n'))
  if (breakPoint > 200) preview = preview.slice(0, breakPoint + 1)
  return preview.trim() || undefined
}

/** Longest README the detail page renders (characters); longer ones end with a link to the full file on GitHub. */
export const README_RENDER_MAX = 100_000

/** The README as rendered: capped at README_RENDER_MAX without splitting a surrogate pair. */
export function capReadme(readme: string): { text: string; truncated: boolean } {
  if (readme.length <= README_RENDER_MAX) return { text: readme, truncated: false }
  let end = README_RENDER_MAX
  const last = readme.charCodeAt(end - 1)
  if (last >= 0xd800 && last <= 0xdbff) end -= 1
  return { text: readme.slice(0, end), truncated: true }
}

/** Cut at the last word boundary that fits `max` characters (ellipsis included). */
export function truncateAtWord(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s.,;:–—-]+$/, '')}…`
}
