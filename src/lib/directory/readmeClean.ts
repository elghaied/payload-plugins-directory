import { createHash } from 'node:crypto'
import { unstable_cache } from 'next/cache'
import { fromHtml } from 'hast-util-from-html'
import { sanitize, type Schema } from 'hast-util-sanitize'
import { toHtml } from 'hast-util-to-html'
import { pluginTag } from '@/lib/cacheTags'
import { readmeSanitizeSchema } from './markdown'

/**
 * Read-time schema: the write-time schema (GitHub's, see markdown.ts) with two differences, both needed because the
 * stored HTML is the OUTPUT of the write-time pipeline, not author input:
 *  - `clobber` is off: ids and names already carry the `user-content-` prefix; prefixing again would break anchors;
 *  - the attributes the pipeline adds after sanitizing (link target/rel, image loading/decoding/referrerpolicy) are
 *    allowed, each restricted to the single value the pipeline writes.
 */
export const storedReadmeSchema: Schema = {
  ...(readmeSanitizeSchema as Schema),
  clobber: [],
  attributes: {
    ...(readmeSanitizeSchema as Schema).attributes,
    a: [...((readmeSanitizeSchema.attributes?.a ?? []) as never[]), ['target', '_blank'], ['rel', 'nofollow', 'ugc', 'noopener', 'noreferrer']],
    img: [...((readmeSanitizeSchema.attributes?.img ?? []) as never[]), ['loading', 'lazy'], ['decoding', 'async'], ['referrerPolicy', 'no-referrer']],
    // The footnote heading is an h2 (class sr-only) at sanitize time; the pipeline then demotes it to h3.
    h3: [...((readmeSanitizeSchema.attributes?.h3 ?? []) as never[]), ['className', 'sr-only']],
    source: [...((readmeSanitizeSchema.attributes?.source ?? []) as never[]), ['referrerPolicy', 'no-referrer']],
  },
}

/**
 * Stored README HTML parsed (parse5, linear), sanitized again with the write-time schema and serialised. Anything
 * a bug or a hand-edited row put into the stored value that the schema does not allow is dropped here. Returns null
 * on any error (the page then shows plain text).
 */
export function cleanStoredReadmeHtml(html: string): string | null {
  try {
    return toHtml(sanitize(fromHtml(html, { fragment: true }), storedReadmeSchema))
  } catch {
    return null
  }
}

/** Re-sanitized once per stored value: keyed by slug + render version + hash of the stored HTML; tagged `plugin:<slug>`. */
export function getCleanReadmeHtml(slug: string, html: string, version: string | null): Promise<string | null> {
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 32)
  return unstable_cache(async () => cleanStoredReadmeHtml(html), ['readme-html-clean', slug, version ?? 'none', hash], { tags: [pluginTag(slug)] })()
}
