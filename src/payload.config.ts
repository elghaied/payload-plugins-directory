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
import { pluginSnapshots, repositorySnapshots } from './db/snapshots'
import { healthEndpoint } from './endpoints/health'
import { DirectorySettings } from './globals/DirectorySettings'
import { getServerURL } from './lib/serverUrl'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },
  collections: [Users, Maintainers, Repositories, Plugins, Categories, Tags, Submissions, Media],
  globals: [DirectorySettings],
  endpoints: [healthEndpoint],
  cli: { commands: { seed: './cli/seed.js#seedCommand' } },
  secret: process.env.PAYLOAD_SECRET || '',
  // Runtime value (SERVER_URL): Payload derives CSRF/CORS allowed origins from it.
  serverURL: getServerURL(),
  upload: { transformers: [sharpTransformer()] },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  db: postgresAdapter({
    pool: { connectionString: process.env.DATABASE_URL || '' },
    migrationDir: path.resolve(dirname, 'migrations'),
    push: false,
    beforeSchemaInit: [
      ({ schema }) => ({
        ...schema,
        tables: { ...schema.tables, repository_snapshots: repositorySnapshots, plugin_snapshots: pluginSnapshots },
      }),
    ],
  }),
})
