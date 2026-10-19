#!/bin/sh
set -e
case "$1" in
  web)
    (cd /app/cli && npx payload migrate)
    exec node /app/server.js
    ;;
  worker)
    # Sync jobs (src/cli/worker.ts): queue due schedules and run jobs every minute.
    # Migrations are run by the web container; compose starts the worker once web is healthy.
    # Run exactly ONE worker: handleSchedules is not locked across processes.
    # exec + direct bin (no npx wrapper) so SIGTERM reaches the worker, which then shuts down gracefully.
    cd /app/cli
    export DIRECTORY_ROLE=worker
    exec ./node_modules/.bin/payload worker --cron "* * * * *"
    ;;
  refresh)
    # Stopgap data refresh: GitHub/npm -> data/plugins.json -> Postgres. Needs GITHUB_TOKEN.
    if [ -z "${GITHUB_TOKEN:-}" ]; then
      echo "refresh: GITHUB_TOKEN is not set; refusing to run (would seed stale data)" >&2
      exit 1
    fi
    cd /app/cli
    started=$(date +%s)
    npx tsx scripts/fetch-plugins.ts
    # Abort unless the fetch really rewrote data/plugins.json after we started.
    node -e '
      const t = Date.parse(JSON.parse(require("fs").readFileSync("data/plugins.json", "utf8")).lastUpdated);
      if (!(t >= Number(process.argv[1]) * 1000)) { console.error("refresh: data/plugins.json was not updated by the fetch; aborting before seed"); process.exit(1); }
    ' "$started"
    npx payload seed
    ;;
  *)
    exec "$@"
    ;;
esac
