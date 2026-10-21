/** The README as escaped plain text: the fallback when no (safe) rendered HTML exists. */
export function ReadmePlain({ source }: { source: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-sans leading-relaxed bg-transparent p-0 m-0 border-0">
      {source}
    </pre>
  )
}

/**
 * README HTML that has already been re-sanitized on read (getCleanReadmeHtml: parse5 + hast-util-sanitize with the
 * write-time schema), which in turn was sanitized by rehype-sanitize when the worker stored it. This is the only
 * dangerouslySetInnerHTML in the app and it receives only that cleaned output, inside a scoped container.
 */
export function ReadmeHtml({ cleanHtml }: { cleanHtml: string }) {
  return <div className="readme-prose" dangerouslySetInnerHTML={{ __html: cleanHtml }} />
}
