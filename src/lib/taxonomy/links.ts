/** Public taxonomy URLs. Phase 5's src/lib/search/links.ts builds the same ones. */
export const categoryHref = (path: string): string => `/categories/${path.split('/').map(encodeURIComponent).join('/')}`
export const tagHref = (slug: string): string => `/?tag=${encodeURIComponent(slug)}`
export const categoryFilterHref = (slug: string): string => `/?category=${encodeURIComponent(slug)}`
