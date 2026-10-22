import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sharpTransformer } from '@payloadcms/transformer-sharp'

import { Categories } from './collections/Categories'
import { TemplateCategories } from './collections/TemplateCategories'
import { Maintainers } from './collections/Maintainers'
import { Media } from './collections/Media'
import { Plugins } from './collections/Plugins'
import { Repositories } from './collections/Repositories'
import { Submissions } from './collections/Submissions'
import { Templates } from './collections/Templates'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { isAdmin } from './access'
import { jobStatus } from './db/jobStatus'
import { pluginSnapshots, repositorySnapshots } from './db/snapshots'
import { healthEndpoint } from './endpoints/health'
import { runJobEndpoint } from './endpoints/runJob'
import { DirectorySettings } from './globals/DirectorySettings'
import { runtimeEnvNotices, runtimeEnvWarnings } from './lib/runtimeEnv'
import { getServerURL } from './lib/serverUrl'
import { directorySearchPlugin } from './lib/search/plugin'
import { directoryMcpPlugin } from './mcp/plugin'
import { jobsConfig } from './sync/tasks'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    dashboard: {
      widgets: [
        {
          slug: 'welcome',
          label: 'Welcome',
          Component: './components/admin/WelcomeWidget.tsx#WelcomeWidget',
          minWidth: 'large',
        },
        {
          slug: 'job-health',
          label: 'Jobs',
          Component: './components/admin/JobHealthWidget.tsx#JobHealthWidget',
          minWidth: 'large',
        },
        {
          slug: 'submissions',
          label: 'Submissions',
          Component: './components/admin/SubmissionsWidget.tsx#SubmissionsWidget',
          minWidth: 'medium',
        },
        {
          slug: 'enrichment',
          label: 'AI enrichment',
          Component: './components/admin/EnrichmentWidget.tsx#EnrichmentWidget',
          minWidth: 'small',
        },
      ],
      defaultLayout: [
        { widgetSlug: 'welcome', width: 'full' },
        { widgetSlug: 'job-health', width: 'full' },
        { widgetSlug: 'submissions', width: 'large' },
        { widgetSlug: 'enrichment', width: 'small' },
        { widgetSlug: 'collections', width: 'full' },
      ],
    },
  },
  collections: [Users, Maintainers, Repositories, Plugins, Templates, Categories, TemplateCategories, Tags, Submissions, Media],
  globals: [DirectorySettings],
  // Admin presets (Low confidence, Uncategorized, Enrichment failed). v4 would allow any authenticated user,
  // which includes maintainers once Phase 4 adds their login.
  queryPresets: { access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin }, constraints: {} },
  endpoints: [healthEndpoint, runJobEndpoint],
  plugins: [directorySearchPlugin(), ...directoryMcpPlugin()],
  jobs: jobsConfig,
  cli: { commands: { seed: './cli/seed.js#seedCommand', worker: './cli/worker.js#workerCommand', 'seed-taxonomy': './cli/taxonomy.js#seedTaxonomyCommand', enrich: './cli/enrich.js#enrichCommand', 'reindex-search': './cli/reindexSearch.js#reindexSearchCommand', 'render-readmes': './cli/renderReadmes.js#renderReadmesCommand' } },
  secret: process.env.PAYLOAD_SECRET || '',
  // Runtime value (SERVER_URL): Payload derives CSRF/CORS allowed origins from it.
  serverURL: getServerURL(),
  // Silent production misconfigurations (wrong SERVER_URL noindexes the site) are logged at startup.
  onInit: (payload) => {
    const role = process.env.DIRECTORY_ROLE === 'worker' ? 'worker' : 'web'
    for (const warning of runtimeEnvWarnings(process.env, role)) payload.logger.warn(warning)
    for (const notice of runtimeEnvNotices(process.env, role)) payload.logger.info(notice)
  },
  upload: {
    transformers: [
      sharpTransformer({
        collections: {
          // v4 beta: image sizes are `variants` on the sharp transformer (`upload.imageSizes` was removed).
          media: {
            variants: [
              { name: 'gallery', width: 1600, withoutEnlargement: true, formatOptions: { format: 'webp', options: { quality: 85 } } },
              { name: 'card', width: 640, withoutEnlargement: true, formatOptions: { format: 'webp', options: { quality: 85 } } },
            ],
          },
        },
      }),
    ],
  },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL || '' },
    migrationDir: path.resolve(dirname, 'migrations'),
    push: false,
    beforeSchemaInit: [
      ({ schema }) => ({
        ...schema,
        tables: {
          ...schema.tables,
          repository_snapshots: repositorySnapshots,
          plugin_snapshots: pluginSnapshots,
          job_status: jobStatus,
        },
      }),
    ],
  }),
})
