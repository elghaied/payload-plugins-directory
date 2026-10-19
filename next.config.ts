import path from 'path'
import { fileURLToPath } from 'url'
import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  output: 'standalone',
  images: { localPatterns: [{ pathname: '/api/media/file/**' }] },
  // Logos are capped at 512 KB; keep the server-action body limit at 1 MB (the default) rather than raising it.
  experimental: { serverActions: { bodySizeLimit: '1mb' } },
  turbopack: { root: path.resolve(dirname) },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
