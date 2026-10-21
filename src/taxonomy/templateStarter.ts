import type { StarterCategory } from './starter'

/**
 * Starter template categories (Phase 6), seeded once by the `seed_template_categories` data migration. Admins own
 * the tree afterwards: seeding only creates missing slugs and never edits or deletes. Slugs follow validateTaxonomySlug().
 */

/** The AI's answer when no category fits a template. Must exist in the starter list. */
export const TEMPLATE_FALLBACK_CATEGORY_SLUG = 'starters-boilerplates'

export const STARTER_TEMPLATE_CATEGORIES: StarterCategory[] = [
  { slug: 'landing-pages', title: 'Landing pages', icon: 'layout-template', intro: 'Marketing sites and landing pages with a Payload-managed page builder, ready to launch a product or campaign.' },
  { slug: 'portfolios', title: 'Portfolios & personal', icon: 'user-round', intro: 'Personal sites, portfolios and resumes where Payload manages projects, writing and profile content.' },
  { slug: 'blogs-publishing', title: 'Blogs & publishing', icon: 'newspaper', intro: 'Blogs, magazines and editorial sites with posts, authors, categories and publishing workflows.' },
  { slug: 'ecommerce', title: 'E-commerce', icon: 'shopping-cart', intro: 'Online stores with products, carts, checkout and orders managed in Payload.' },
  { slug: 'saas-dashboards', title: 'SaaS & dashboards', icon: 'layout-dashboard', intro: 'Starting points for SaaS products and dashboards with authentication, billing and multi-user data.' },
  { slug: 'business-agency', title: 'Business & agency', icon: 'briefcase', intro: 'Company, agency and service-business websites with team, services, case studies and contact forms.' },
  { slug: 'docs-knowledge', title: 'Docs & knowledge bases', icon: 'book-open', intro: 'Documentation sites and knowledge bases with structured, searchable content.' },
  { slug: TEMPLATE_FALLBACK_CATEGORY_SLUG, title: 'Starters & boilerplates', icon: 'rocket', intro: 'Minimal and general-purpose Payload starters and boilerplates to build any project from.' },
]
