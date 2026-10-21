/** Limits shared by the render worker, the Plugins collection and the detail page. No imports: loaded by the render worker. */

/** Longest README (characters) rendered as Markdown; longer text is cut and the page links to GitHub for the rest. */
export const README_MARKDOWN_MAX = 60_000
/** Largest stored README HTML (plugins.readmeHtml, characters); bigger renders are dropped to plain text. */
export const README_HTML_MAX_CHARS = 400_000
