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
