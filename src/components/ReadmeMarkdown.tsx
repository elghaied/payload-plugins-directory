import { Fragment, type ReactNode } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'
import { toJsxRuntime } from 'hast-util-to-jsx-runtime'
import type { Root } from 'hast'
import type { RepoRef } from '@/lib/directory/markdown'
import { getReadmeTree } from '@/lib/directory/readmeCache'

/** The README as escaped plain text: the fallback for input that cannot be rendered safely as Markdown. */
export function ReadmePlain({ source }: { source: string }) {
  return (
    <pre className="whitespace-pre-wrap break-words text-sm text-foreground font-sans leading-relaxed bg-transparent p-0 m-0 border-0">
      {source}
    </pre>
  )
}

/** A sanitized README tree as React elements (no dangerouslySetInnerHTML), or the plain-text fallback for null. */
export function ReadmeView({ tree, source }: { tree: Root | null; source: string }) {
  if (!tree) return <ReadmePlain source={source} />
  let body: ReactNode
  try {
    body = toJsxRuntime(tree, { Fragment, jsx, jsxs })
  } catch {
    return <ReadmePlain source={source} />
  }
  return <div className="readme-prose">{body}</div>
}

/** Server-side: a cached render of the untrusted README (see readmeCache). Never throws. */
export async function renderReadme(slug: string, source: string, repo: RepoRef): Promise<ReactNode> {
  let tree: Root | null = null
  try {
    tree = (await getReadmeTree(slug, source, repo)).tree
  } catch {
    tree = null
  }
  return <ReadmeView tree={tree} source={source} />
}
