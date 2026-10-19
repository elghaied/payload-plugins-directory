FROM node:24.15-alpine AS base
RUN apk add --no-cache libc6-compat && corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# the repo has no public/ directory; the runner stage copies it unconditionally
RUN mkdir -p public && pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 MEDIA_DIR=/app/media
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs && mkdir -p /app/media && chown nextjs:nodejs /app/media
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
# Full sources + deps for the Payload CLI (migrate, seed, worker)
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./cli/node_modules
COPY --from=builder --chown=nextjs:nodejs /app/package.json /app/tsconfig.json ./cli/
COPY --from=builder --chown=nextjs:nodejs /app/src ./cli/src
COPY --chown=nextjs:nodejs docker/entrypoint.sh /entrypoint.sh
USER nextjs
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["web"]
