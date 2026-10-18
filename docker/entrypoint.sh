#!/bin/sh
set -e
case "$1" in
  web)
    (cd /app/cli && npx payload migrate)
    exec node /app/server.js
    ;;
  refresh)
    # Stopgap data refresh: GitHub/npm -> data/plugins.json -> Postgres. Needs GITHUB_TOKEN.
    cd /app/cli
    npx tsx scripts/fetch-plugins.ts
    npx payload seed
    ;;
  *)
    exec "$@"
    ;;
esac
