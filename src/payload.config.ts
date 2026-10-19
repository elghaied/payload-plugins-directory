import path from 'path'
import { fileURLToPath } from 'url'
import { buildConfig } from 'payload'
import { postgresAdapter } from '@payloadcms/db-postgres'
import { sharpTransformer } from '@payloadcms/transformer-sharp'

import { Categories } from './collections/Categories'
import { Maintainers } from './collections/Maintainers'
import { Media } from './collections/Media'
import { Plugins } from './collections/Plugins'
import { Repositories } from './collections/Repositories'
import { Submissions } from './collections/Submissions'
import { Tags } from './collections/Tags'
import { Users } from './collections/Users'
import { isAdmin } from './access'
import { jobStatus } from './db/jobStatus'
import { pluginSnapshots, repositorySnapshots } from './db/snapshots'
import { healthEndpoint } from './endpoints/health'
import { DirectorySettings } from './globals/DirectorySettings'
import { runtimeEnvWarnings } from './lib/runtimeEnv'
import { getServerURL } from './lib/serverUrl'
import { jobsConfig } from './sync/tasks'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
    dashboard: {
      widgets: [
        {
          slug: 'job-health',
          label: 'Job health',
          Component: './components/admin/JobHealthWidget.tsx#JobHealthWidget',
          minWidth: 'medium',
        },
        {
          slug: 'enrichment',
          label: 'AI enrichment',
          Component: './components/admin/EnrichmentWidget.tsx#EnrichmentWidget',
          minWidth: 'medium',
        },
      ],
      defaultLayout: [
        { widgetSlug: 'job-health', width: 'full' },
        { widgetSlug: 'enrichment', width: 'full' },
        { widgetSlug: 'collections', width: 'full' },
      ],
    },
  },
  collections: [Users, Maintainers, Repositories, Plugins, Categories, Tags, Submissions, Media],
  globals: [DirectorySettings],
  // Admin presets (Low confidence, Uncategorized, Enrichment failed). v4 would allow any authenticated user,
  // which includes maintainers once Phase 4 adds their login.
  queryPresets: { access: { read: isAdmin, create: isAdmin, update: isAdmin, delete: isAdmin }, constraints: {} },
  endpoints: [healthEndpoint],
  jobs: jobsConfig,
  cli: { commands: { seed: './cli/seed.js#seedCommand', worker: './cli/worker.js#workerCommand', 'seed-taxonomy': './cli/taxonomy.js#seedTaxonomyCommand', enrich: './cli/enrich.js#enrichCommand' } },
  secret: process.env.PAYLOAD_SECRET || '',
  // Runtime value (SERVER_URL): Payload derives CSRF/CORS allowed origins from it.
  serverURL: getServerURL(),
  // Silent production misconfigurations (wrong SERVER_URL noindexes the site) are logged at startup.
  onInit: (payload) => {
    const role = process.env.DIRECTORY_ROLE === 'worker' ? 'worker' : 'web'
    for (const warning of runtimeEnvWarnings(process.env, role)) payload.logger.warn(warning)
  },
  upload: { transformers: [sharpTransformer()] },
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
