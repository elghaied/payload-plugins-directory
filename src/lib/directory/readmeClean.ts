import { createHash } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { unified } from 'unified'
import rehypeSanitize from 'rehype-sanitize'
import type { Element, Root } from 'hast'
import { pluginTag } from '@/lib/cacheTags'
import { readmeSanitizeSchema, rehypeReadme } from './markdown'

const PREFIX = 'user-content-'

/**
 * Read-time schema: the write-time schema plus the sr-only footnote heading class (an h2 at sanitize time that the
 * pipeline later demotes to h3). Everything else, including the clobber prefix, is the write-time schema.
 */
const readSchema: typeof readmeSanitizeSchema = {
  ...readmeSanitizeSchema,
  attributes: {
    ...readmeSanitizeSchema.attributes,
    h3: [...((readmeSanitizeSchema.attributes?.h3 ?? []) as never[]), ['className', 'sr-only']],
  },
}

const unprefix = (value: string) => (value.startsWith(PREFIX) ? value.slice(PREFIX.length) : value)

/**
 * The stored HTML is the OUTPUT of the write pipeline, so its ids, names, aria references and in-page links already
 * carry the `user-content-` prefix. Removing exactly one prefix first lets the write-time sanitizer (which prefixes)
 * and anchor resolution run unchanged: legitimate values end up as they were, and an unprefixed (hostile or
 * hand-edited) id or name gets prefixed exactly as it would have been at write time.
 */
function stripPrefixOnce(node: Root | Element): void {
  for (const child of node.children) {
    if (child.type !== 'element') continue
    const props = child.properties
    for (const key of ['id', 'name'] as const) if (typeof props[key] === 'string') props[key] = unprefix(props[key])
    for (const key of ['ariaDescribedBy', 'ariaLabelledBy'] as const) {
      const v = props[key]
      if (typeof v === 'string') props[key] = v.split(/\s+/).filter(Boolean).map(unprefix).join(' ')
      else if (Array.isArray(v)) props[key] = v.map((t) => unprefix(String(t)))
    }
    if (child.tagName === 'a' && typeof props.href === 'string' && props.href.startsWith(`#${PREFIX}`)) props.href = `#${unprefix(props.href.slice(1))}`
    stripPrefixOnce(child)
  }
}

/**
 * Stored README HTML parsed (parse5, linear) and run through the SAME rules as at write time (the write-time schema,
 * clobber prefix, the image host allow-list and srcset checks, forced referrerpolicy/rel/target) minus the Markdown
 * parse. Relative URLs cannot occur in stored HTML and are dropped. Returns null on any error (the page then shows
 * plain text).
 */
export function cleanStoredReadmeHtml(html: string): string | null {
  try {
    const tree = fromHtml(html, { fragment: true })
    stripPrefixOnce(tree)
    const processor = unified().use(rehypeSanitize, readSchema).use(rehypeReadme, { fullName: 'unknown/unknown' }, { demoteHeadings: false, relative: 'drop' })
    return toHtml(processor.runSync(tree) as Root)
  } catch {
    return null
  }
}

/** Re-sanitized once per stored value: keyed by slug + render version + hash of the stored HTML; tagged `plugin:<slug>`. */
export function getCleanReadmeHtml(slug: string, html: string, version: string | null): Promise<string | null> {
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 32)
  return unstable_cache(async () => cleanStoredReadmeHtml(html), ['readme-html-clean', slug, version ?? 'none', hash], { tags: [pluginTag(slug)] })()
}
