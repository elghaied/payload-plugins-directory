import path from 'path'
import { fileURLToPath } from 'url'
import type { NextConfig } from 'next'
import { withPayload } from '@payloadcms/next/withPayload'

const dirname = path.dirname(fileURLToPath(import.meta.url))

const nextConfig: NextConfig = {
  output: 'standalone',
  images: { localPatterns: [{ pathname: '/api/media/file/**' }] },
  // Server-action body limit: one template screenshot (capped at 2 MB) per action call, plus form fields and multipart
  // overhead. Logos (512 KB) fit too. Each upload action reads exactly one file; never send several in one call.
  experimental: { serverActions: { bodySizeLimit: '3mb' } },
  turbopack: { root: path.resolve(dirname) },
  // Payload serves uploads through `file-type`, whose ESM imports (strtok3's index.js and friends) the standalone trace
  // misses: without these, every /api/media/file request 500s in the Docker image (dev is unaffected).
  outputFileTracingIncludes: {
    '/**': [
      './node_modules/.pnpm/file-type@*/node_modules/**',
      './node_modules/.pnpm/strtok3@*/node_modules/**',
      './node_modules/.pnpm/token-types@*/node_modules/**',
      './node_modules/.pnpm/@tokenizer+*/node_modules/**',
      './node_modules/.pnpm/uint8array-extras@*/node_modules/**',
    ],
  },
}

export default withPayload(nextConfig, { devBundleServerPackages: false })
