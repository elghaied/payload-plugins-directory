import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaxonomyFilters } from '@/components/PluginDirectory/TaxonomyFilters'

describe('TaxonomyFilters drawer', () => {
  it('ties each label to its select trigger', () => {
    const html = renderToStaticMarkup(
      createElement(TaxonomyFilters, {
        variant: 'drawer', categories: [], tags: [{ slug: 's3', title: 'S3', count: 1 }], category: 'all', tag: 'all',
        uncategorizedCount: 0, onCategoryChange: () => {}, onTagChange: () => {},
      }),
    )
    for (const id of ['filter-drawer-category', 'filter-drawer-tag']) {
      expect(html).toContain(`for="${id}"`)
      expect(html).toMatch(new RegExp(`<button[^>]*id="${id}"`))
    }
  })
})
