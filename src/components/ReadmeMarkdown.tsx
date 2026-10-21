import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import { readmeSanitizeSchema, rehypeReadme, type RepoRef } from '@/lib/directory/markdown'

/**
 * A README rendered as GitHub-flavoured Markdown on the server. The source is untrusted author content:
 * raw HTML is parsed, then sanitized with GitHub's schema, then relative URLs are rewritten to the repository.
 */
export function ReadmeMarkdown({ source, repo }: { source: string; repo: RepoRef }) {
  return (
    <div className="readme-prose">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, readmeSanitizeSchema], [rehypeReadme, repo]]}
      >
        {source}
      </Markdown>
    </div>
  )
}
