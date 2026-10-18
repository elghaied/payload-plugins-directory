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

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default buildConfig({
  admin: {
    user: Users.slug,
    importMap: { baseDir: path.resolve(dirname) },
  },
  collections: [Users, Maintainers, Repositories, Plugins, Categories, Tags, Submissions, Media],
  globals: [DirectorySettings],
  endpoints: [healthEndpoint],
  secret: process.env.PAYLOAD_SECRET || '',
  serverURL: process.env.NEXT_PUBLIC_SITE_URL || '',
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
