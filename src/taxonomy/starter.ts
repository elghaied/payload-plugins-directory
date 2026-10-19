/**
 * Starter taxonomy (spec §3.1, §10 Phase 2), seeded once by the `seed_taxonomy` data migration. Admins own
 * the tree afterwards: seeding only creates missing slugs and never edits or deletes.
 * Titles must not contain "/" (Payload joins title paths with "/"). Slugs follow validateTaxonomySlug().
 */
export type StarterCategory = { slug: string; title: string; intro: string; icon: string; children?: StarterCategory[] }

/** The AI's answer when no leaf fits (spec §3.1). Must stay a leaf. */
export const OTHER_CATEGORY_SLUG = 'other'

export const STARTER_CATEGORIES: StarterCategory[] = [
  {
    slug: 'storage-media', title: 'Storage & Media', icon: 'hard-drive',
    intro: 'Plugins that decide where Payload keeps uploaded files and how images, video and other media are processed and delivered.',
    children: [
      { slug: 'cloud-storage', title: 'Cloud storage', icon: 'cloud', intro: 'Storage adapters that keep Payload uploads in Amazon S3, Cloudflare R2, Azure Blob, Google Cloud Storage, Vercel Blob or other object stores instead of the local disk.' },
      { slug: 'media-management', title: 'Media & images', icon: 'image', intro: 'Image optimisation, focal points, alt text, video handling, galleries and media library improvements for the Payload admin.' },
    ],
  },
  {
    slug: 'auth-access', title: 'Authentication & Access', icon: 'shield',
    intro: 'Plugins for signing users in and deciding what each user may read or change in Payload.',
    children: [
      { slug: 'authentication', title: 'Authentication & SSO', icon: 'key-round', intro: 'Sign-in for the Payload admin or your app users: OAuth and OpenID Connect providers, SSO, passkeys, magic links and two-factor authentication.' },
      { slug: 'access-control', title: 'Roles & permissions', icon: 'lock', intro: 'Role-based access control, field and document permissions, and multi-tenant setups that keep each tenant’s content apart.' },
    ],
  },
  {
    slug: 'seo-publishing', title: 'SEO & Publishing', icon: 'file-search',
    intro: 'Plugins that help content get found and published: metadata, URLs, redirects and editorial workflows.',
    children: [
      { slug: 'seo', title: 'SEO & metadata', icon: 'search-check', intro: 'Meta titles and descriptions, Open Graph images, sitemaps, structured data and other search-engine essentials for Payload content.' },
      { slug: 'redirects-urls', title: 'Redirects & URLs', icon: 'link', intro: 'Redirect managers, slug generation, nested document paths and other URL helpers for Payload sites.' },
      { slug: 'publishing-workflow', title: 'Publishing workflow', icon: 'calendar-clock', intro: 'Scheduled publishing, live preview, approval steps, comments, versions and other editorial tools for content teams.' },
    ],
  },
  {
    slug: 'commerce', title: 'Ecommerce & Payments', icon: 'shopping-cart',
    intro: 'Plugins for selling with Payload: payment providers, products, carts, orders and connections to commerce platforms.',
    children: [
      { slug: 'payments', title: 'Payments', icon: 'credit-card', intro: 'Stripe, PayPal, Mollie and other payment providers: checkouts, subscriptions, invoices and payment webhooks.' },
      { slug: 'ecommerce', title: 'Stores & catalogs', icon: 'store', intro: 'Products, variants, carts, orders and inventory for shops built on Payload, including connectors to external commerce platforms.' },
    ],
  },
  {
    slug: 'forms-communication', title: 'Forms & Communication', icon: 'mail',
    intro: 'Plugins that collect input from visitors and send messages: forms, email and notifications.',
    children: [
      { slug: 'forms', title: 'Forms', icon: 'clipboard-list', intro: 'Form builders, submissions, validation, file fields and spam protection for forms managed in Payload.' },
      { slug: 'email', title: 'Email', icon: 'send', intro: 'Email adapters and transactional email templates for Resend, SendGrid, Postmark, SMTP and newsletter tools such as Mailchimp.' },
      { slug: 'notifications', title: 'Notifications & messaging', icon: 'bell', intro: 'SMS, push notifications, chat messages and webhook notifications triggered by Payload events.' },
    ],
  },
  {
    slug: 'search', title: 'Search', icon: 'search',
    intro: 'Full-text search for Payload content: search indexes and connectors for Algolia, Meilisearch, Typesense, Elasticsearch or Postgres.',
  },
  {
    slug: 'i18n', title: 'Internationalization', icon: 'languages',
    intro: 'Plugins for multilingual Payload projects: locales, localized content and translation workflows.',
    children: [
      { slug: 'localization', title: 'Localized content', icon: 'globe', intro: 'Locale switching, localized fields, per-locale publishing and helpers for multi-language Payload sites.' },
      { slug: 'translation', title: 'Translation', icon: 'languages', intro: 'Machine and human translation of Payload content and admin labels, including DeepL, Google Translate and LLM translators.' },
    ],
  },
  {
    slug: 'admin-ui', title: 'Admin UI & Fields', icon: 'layout-dashboard',
    intro: 'Plugins that extend the Payload admin panel: new field types, editor features and visual customisation.',
    children: [
      { slug: 'custom-fields', title: 'Custom fields', icon: 'text-cursor-input', intro: 'New field types and field enhancements such as color pickers, icon pickers, maps, conditional and computed fields.' },
      { slug: 'rich-text', title: 'Rich text & editors', icon: 'pilcrow', intro: 'Lexical editor features, blocks, embeds, tables and other improvements to rich-text editing in Payload.' },
      { slug: 'admin-customization', title: 'Admin customization', icon: 'palette', intro: 'Dashboards, themes, branding, navigation and other changes to the look and behaviour of the Payload admin panel.' },
    ],
  },
  {
    slug: 'ai', title: 'AI', icon: 'sparkles',
    intro: 'Plugins that bring large language models and machine learning into Payload content and search.',
    children: [
      { slug: 'ai-content', title: 'AI content generation', icon: 'wand-sparkles', intro: 'Generate, rewrite, summarise or translate content, alt text and SEO fields with large language models from the Payload admin.' },
      { slug: 'ai-search', title: 'AI search & embeddings', icon: 'brain', intro: 'Embeddings, vector stores, semantic search and retrieval-augmented chat over Payload content.' },
    ],
  },
  {
    slug: 'analytics-monitoring', title: 'Analytics & Monitoring', icon: 'chart-line',
    intro: 'Plugins that measure how a Payload site is used and how the application behaves.',
    children: [
      { slug: 'analytics', title: 'Analytics', icon: 'chart-column', intro: 'Website analytics, tracking scripts, A/B tests and reporting dashboards inside Payload.' },
      { slug: 'monitoring', title: 'Logging & monitoring', icon: 'activity', intro: 'Audit logs, activity history, error tracking, performance monitoring and health checks for Payload applications.' },
    ],
  },
  {
    slug: 'integrations', title: 'Integrations & Data', icon: 'plug',
    intro: 'Plugins that move content in and out of Payload and connect it to databases and outside services.',
    children: [
      { slug: 'importers', title: 'Import, export & migration', icon: 'file-input', intro: 'Bring content into Payload from WordPress, Contentful, Strapi, Sanity, CSV or JSON, export it again, or migrate between Payload versions.' },
      { slug: 'third-party', title: 'Third-party services', icon: 'blocks', intro: 'Connectors to CRMs, marketing tools, Slack, Shopify, GitHub and other external services.' },
      { slug: 'database-tools', title: 'Databases & data', icon: 'database', intro: 'Database adapters, data seeding, backups, caching layers and data synchronisation for Payload.' },
    ],
  },
  {
    slug: 'dev-tooling', title: 'Developer Tooling', icon: 'wrench',
    intro: 'Plugins that make building and running Payload projects faster: APIs, testing and automation.',
    children: [
      { slug: 'api-tooling', title: 'APIs & SDKs', icon: 'braces', intro: 'REST, GraphQL, OpenAPI, tRPC and typed client tooling built on Payload’s APIs.' },
      { slug: 'testing-dx', title: 'Testing & developer experience', icon: 'flask-conical', intro: 'Testing utilities, fixtures, type generation, CLIs, debugging aids and other tooling for Payload developers.' },
      { slug: 'jobs-automation', title: 'Jobs & automation', icon: 'workflow', intro: 'Background jobs, cron schedules, webhooks and workflow automation around Payload data.' },
    ],
  },
  {
    slug: OTHER_CATEGORY_SLUG, title: 'Other', icon: 'shapes',
    intro: 'Payload plugins that do not fit any other category yet. Admins move them into better categories over time.',
  },
]

export type StarterTag = { slug: string; title: string; aliases: string[] }

/**
 * Starter tags with the GitHub topics / npm keywords that map to them (sync adds alias-mapped tags; spec §3.1).
 * Aliases are lower case and unique across tags. `payload-plugin` and similar ubiquitous topics are never aliases.
 */
export const STARTER_TAGS: StarterTag[] = [
  { slug: 'seo', title: 'SEO', aliases: ['seo', 'search-engine-optimization', 'meta-tags', 'opengraph', 'open-graph'] },
  { slug: 'sitemap', title: 'Sitemap', aliases: ['sitemap', 'sitemaps', 'sitemap-xml'] },
  { slug: 'redirects', title: 'Redirects', aliases: ['redirects', 'redirect'] },
  { slug: 'slugs', title: 'Slugs', aliases: ['slug', 'slugs', 'permalink', 'permalinks'] },
  { slug: 's3', title: 'Amazon S3', aliases: ['s3', 'aws-s3', 'amazon-s3'] },
  { slug: 'cloudflare-r2', title: 'Cloudflare R2', aliases: ['r2', 'cloudflare-r2'] },
  { slug: 'azure', title: 'Azure', aliases: ['azure', 'azure-blob', 'azure-storage'] },
  { slug: 'google-cloud-storage', title: 'Google Cloud Storage', aliases: ['gcs', 'google-cloud-storage'] },
  { slug: 'vercel-blob', title: 'Vercel Blob', aliases: ['vercel-blob'] },
  { slug: 'uploadthing', title: 'UploadThing', aliases: ['uploadthing'] },
  { slug: 'cloudinary', title: 'Cloudinary', aliases: ['cloudinary'] },
  { slug: 'image-optimization', title: 'Image optimization', aliases: ['image', 'images', 'sharp', 'image-optimization', 'blurhash'] },
  { slug: 'video', title: 'Video', aliases: ['video', 'mux', 'youtube'] },
  { slug: 'stripe', title: 'Stripe', aliases: ['stripe', 'stripe-payments'] },
  { slug: 'paypal', title: 'PayPal', aliases: ['paypal'] },
  { slug: 'shopify', title: 'Shopify', aliases: ['shopify'] },
  { slug: 'oauth', title: 'OAuth', aliases: ['oauth', 'oauth2', 'openid', 'oidc', 'openid-connect'] },
  { slug: 'sso', title: 'SSO', aliases: ['sso', 'saml', 'single-sign-on'] },
  { slug: 'passkeys', title: 'Passkeys', aliases: ['passkey', 'passkeys', 'webauthn'] },
  { slug: 'two-factor', title: 'Two-factor auth', aliases: ['2fa', 'two-factor', 'totp', 'mfa'] },
  { slug: 'multi-tenant', title: 'Multi-tenant', aliases: ['multi-tenant', 'multitenant', 'multi-tenancy', 'tenancy'] },
  { slug: 'rbac', title: 'Roles & permissions', aliases: ['rbac', 'roles', 'permissions', 'access-control'] },
  { slug: 'lexical', title: 'Lexical', aliases: ['lexical', 'lexical-editor'] },
  { slug: 'rich-text', title: 'Rich text', aliases: ['richtext', 'rich-text', 'wysiwyg'] },
  { slug: 'localization', title: 'Localization', aliases: ['i18n', 'l10n', 'localization', 'localisation', 'internationalization', 'locales'] },
  { slug: 'translation', title: 'Translation', aliases: ['translation', 'translate', 'deepl', 'machine-translation'] },
  { slug: 'llm', title: 'LLM', aliases: ['llm', 'ai', 'genai', 'generative-ai', 'artificial-intelligence'] },
  { slug: 'openai', title: 'OpenAI', aliases: ['openai', 'gpt', 'chatgpt'] },
  { slug: 'anthropic', title: 'Anthropic', aliases: ['anthropic', 'claude'] },
  { slug: 'embeddings', title: 'Embeddings', aliases: ['embeddings', 'vector', 'vector-search', 'pgvector', 'rag'] },
  { slug: 'algolia', title: 'Algolia', aliases: ['algolia'] },
  { slug: 'meilisearch', title: 'Meilisearch', aliases: ['meilisearch'] },
  { slug: 'typesense', title: 'Typesense', aliases: ['typesense'] },
  { slug: 'elasticsearch', title: 'Elasticsearch', aliases: ['elasticsearch', 'opensearch'] },
  { slug: 'email', title: 'Email', aliases: ['email', 'mail', 'smtp', 'nodemailer'] },
  { slug: 'resend', title: 'Resend', aliases: ['resend'] },
  { slug: 'sendgrid', title: 'SendGrid', aliases: ['sendgrid'] },
  { slug: 'newsletter', title: 'Newsletter', aliases: ['newsletter', 'mailchimp'] },
  { slug: 'forms', title: 'Forms', aliases: ['forms', 'form', 'form-builder'] },
  { slug: 'analytics', title: 'Analytics', aliases: ['analytics', 'google-analytics', 'plausible', 'posthog', 'umami'] },
  { slug: 'audit-log', title: 'Audit log', aliases: ['audit-log', 'audit', 'activity-log', 'logging'] },
  { slug: 'webhooks', title: 'Webhooks', aliases: ['webhooks', 'webhook'] },
  { slug: 'cron', title: 'Cron & jobs', aliases: ['cron', 'jobs', 'scheduler', 'queue'] },
  { slug: 'graphql', title: 'GraphQL', aliases: ['graphql'] },
  { slug: 'openapi', title: 'OpenAPI', aliases: ['openapi', 'swagger', 'rest-api'] },
  { slug: 'wordpress', title: 'WordPress', aliases: ['wordpress', 'wp'] },
  { slug: 'contentful', title: 'Contentful', aliases: ['contentful'] },
  { slug: 'strapi', title: 'Strapi', aliases: ['strapi'] },
  { slug: 'sanity', title: 'Sanity', aliases: ['sanity'] },
  { slug: 'csv', title: 'CSV import/export', aliases: ['csv', 'import-export', 'xlsx', 'excel'] },
  { slug: 'nextjs', title: 'Next.js', aliases: ['nextjs', 'next-js'] },
  { slug: 'live-preview', title: 'Live preview', aliases: ['live-preview', 'preview', 'draft-preview'] },
  { slug: 'cache', title: 'Caching', aliases: ['cache', 'caching', 'redis'] },
  { slug: 'color-picker', title: 'Color picker', aliases: ['color-picker', 'colour-picker', 'color'] },
  { slug: 'icons', title: 'Icons', aliases: ['icons', 'icon-picker', 'lucide'] },
  { slug: 'maps', title: 'Maps', aliases: ['maps', 'geolocation', 'google-maps', 'mapbox'] },
]
